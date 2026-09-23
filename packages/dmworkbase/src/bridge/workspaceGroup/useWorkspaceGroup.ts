import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkspaceGroupContext, type WorkspaceGroupContext, type WorkspaceGroupTarget,
} from "../../features/workspaceGroup/contract";
import { WorkspaceGroupHostContext } from "../../features/workspaceGroup/WorkspaceGroupProvider";

type Action = "open" | "manage";
type Failure = Action | "load";
type RefreshMode = "external" | "relation" | "retry";
interface State {
  owner: object;
  context: WorkspaceGroupContext | null;
  refreshing: boolean;
  busy: Action | null;
  failure: Failure | null;
}
interface PendingRequest {
  generation: number;
  timedOut: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
}

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export function useWorkspaceGroup(channelId: string, channelType: number) {
  const host = useContext(WorkspaceGroupHostContext);
  const owner = useMemo(() => ({}), [host, channelId, channelType]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const alive = useRef<object | null>(null);
  const request = useRef(0);
  const action = useRef<symbol | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const queuedRelationRefresh = useRef(false);
  const [state, setState] = useState<State | null>(null);
  const current = state?.owner === owner ? state : null;

  const clearRetryTimer = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const cancelPending = useCallback(() => {
    ++request.current;
    queuedRelationRefresh.current = false;
    retryAttempt.current = 0;
    clearRetryTimer();
    if (pending.current?.timeout) clearTimeout(pending.current.timeout);
    pending.current = null;
  }, [clearRetryTimer]);

  const refresh = useCallback(async (invalidate = false, mode: RefreshMode = "external") => {
    if (!host || channelType !== 2 || !channelId || alive.current !== owner) return;
    if (mode !== "retry") {
      retryAttempt.current = 0;
      clearRetryTimer();
    }
    if (!invalidate && pending.current) {
      if (mode === "relation") queuedRelationRefresh.current = true;
      return;
    }
    if (invalidate) {
      action.current = null;
      cancelPending();
    }

    const generation = ++request.current;
    const pendingRequest: PendingRequest = {
      generation,
      timedOut: false,
      timeout: null,
    };
    const timeoutPromise = new Promise<never>((_, reject) => {
      pendingRequest.timeout = setTimeout(() => {
        if (pending.current !== pendingRequest) return;
        pendingRequest.timedOut = true;
        reject(new Error("Workspace group context request timed out"));
      }, REQUEST_TIMEOUT_MS);
    });
    pending.current = pendingRequest;
    setState((previous) => ({
      owner,
      context: !invalidate && previous?.owner === owner ? previous.context : null,
      busy: !invalidate && previous?.owner === owner ? previous.busy : null,
      failure: null,
      refreshing: true,
    }));
    const isLatest = () =>
      pending.current === pendingRequest
      && alive.current === owner
      && currentOwner.current === owner
      && request.current === generation;
    const isCurrent = () => isLatest() && !pendingRequest.timedOut;
    try {
      const target: WorkspaceGroupTarget = { channelId, channelType: 2 };
      const context = await Promise.race([host.getContext(target), timeoutPromise]);
      if (!isCurrent()) return;
      if (context !== null && !isWorkspaceGroupContext(context, target)) throw new Error("Invalid workspace relation");
      if (pendingRequest.timeout) clearTimeout(pendingRequest.timeout);
      pending.current = null;
      retryAttempt.current = 0;
      setState((previous) => ({
        owner, context, refreshing: false, failure: null,
        busy: previous?.owner === owner ? previous.busy : null,
      }));
    } catch {
      if (!isLatest()) return;
      if (pendingRequest.timeout) clearTimeout(pendingRequest.timeout);
      pending.current = null;
      setState((previous) => ({
        owner,
        context: previous?.owner === owner ? previous.context : null,
        busy: previous?.owner === owner ? previous.busy : null,
        refreshing: false,
        failure: "load",
      }));
      if (retryAttempt.current < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[retryAttempt.current];
        retryAttempt.current += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void refresh(false, "retry");
        }, delay);
      }
    } finally {
      if (pending.current === pendingRequest) {
        if (pendingRequest.timeout) clearTimeout(pendingRequest.timeout);
        pending.current = null;
      }
      if (queuedRelationRefresh.current && request.current === generation
          && alive.current === owner && currentOwner.current === owner) {
        queuedRelationRefresh.current = false;
        void refresh(false, "relation");
      }
    }
  }, [host, owner, channelId, channelType, cancelPending, clearRetryTimer]);

  useEffect(() => {
    alive.current = owner;
    if (!host || channelType !== 2 || !channelId) return;
    void refresh(true);
    const unsubscribe = host.subscribe((target) => {
      if (!target || (target.channelId === channelId && target.channelType === channelType)) {
        void refresh(!target, target ? "relation" : "external");
      }
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      if (alive.current === owner) alive.current = null;
      action.current = null;
      cancelPending();
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [host, owner, channelId, channelType, refresh, cancelPending]);

  const run = useCallback(async (kind: Action) => {
    const context = current?.context;
    if (!host || !context || current.refreshing || current.failure || action.current ||
        alive.current !== owner || currentOwner.current !== owner) return;
    if (kind === "open" ? !context.canOpen : (!context.canManage || context.isAllMemberGroup)) return;
    const token = Symbol(kind);
    action.current = token;
    const isCurrent = () => alive.current === owner && currentOwner.current === owner && action.current === token;
    setState((previous) => previous?.owner === owner ? { ...previous, busy: kind, failure: null } : previous);
    try {
      const target = { channelId, channelType: 2 as const, projectId: context.projectId };
      if (kind === "open") {
        await host.open(target);
      } else {
        await host.manage({
          ...target,
          ...(context.linkedBy && context.linkedByName.trim() ? {
            presentation: { linkedBy: context.linkedBy, linkedByName: context.linkedByName },
          } : {}),
        });
      }
      if (isCurrent() && kind === "manage") void refresh();
    } catch {
      if (isCurrent()) {
        setState((previous) => previous?.owner === owner && previous.context?.projectId === context.projectId
          ? { ...previous, failure: kind } : previous);
      }
    } finally {
      if (isCurrent()) {
        action.current = null;
        setState((previous) => previous?.owner === owner ? { ...previous, busy: null } : previous);
      }
    }
  }, [host, current, owner, channelId, refresh]);

  return {
    context: current?.context ?? null,
    refreshing: current?.refreshing ?? false,
    busy: current?.busy ?? null,
    failure: current?.failure ?? null,
    open: () => { void run("open"); },
    manage: () => { void run("manage"); },
    refresh: () => { void refresh(); },
  };
}
