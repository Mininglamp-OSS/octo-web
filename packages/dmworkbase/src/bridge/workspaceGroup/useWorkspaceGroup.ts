import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkspaceGroupContext, type WorkspaceGroupContext, type WorkspaceGroupTarget,
} from "../../features/workspaceGroup/contract";
import { WorkspaceGroupHostContext } from "../../features/workspaceGroup/WorkspaceGroupProvider";

type Action = "open" | "manage";
type Failure = Action | "load";
interface State {
  owner: object;
  context: WorkspaceGroupContext | null;
  refreshing: boolean;
  busy: Action | null;
  failure: Failure | null;
}

export function useWorkspaceGroup(channelId: string, channelType: number) {
  const host = useContext(WorkspaceGroupHostContext);
  const owner = useMemo(() => ({}), [host, channelId, channelType]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const alive = useRef<object | null>(null);
  const request = useRef(0);
  const action = useRef<symbol | null>(null);
  const [state, setState] = useState<State | null>(null);
  const current = state?.owner === owner ? state : null;

  const refresh = useCallback(async (invalidate = false) => {
    if (!host || channelType !== 2 || !channelId || alive.current !== owner) return;
    const generation = ++request.current;
    if (invalidate) action.current = null;
    setState((previous) => ({
      owner,
      context: !invalidate && previous?.owner === owner ? previous.context : null,
      busy: !invalidate && previous?.owner === owner ? previous.busy : null,
      failure: null,
      refreshing: true,
    }));
    const isCurrent = () => alive.current === owner && currentOwner.current === owner && request.current === generation;
    try {
      const target: WorkspaceGroupTarget = { channelId, channelType: 2 };
      const context = await host.getContext(target);
      if (!isCurrent()) return;
      if (context !== null && !isWorkspaceGroupContext(context, target)) throw new Error("Invalid workspace relation");
      setState((previous) => ({
        owner, context, refreshing: false, failure: null,
        busy: previous?.owner === owner ? previous.busy : null,
      }));
    } catch {
      if (!isCurrent()) return;
      setState((previous) => ({
        owner,
        context: previous?.owner === owner ? previous.context : null,
        busy: previous?.owner === owner ? previous.busy : null,
        refreshing: false,
        failure: "load",
      }));
    }
  }, [host, owner, channelId, channelType]);

  useEffect(() => {
    alive.current = owner;
    if (!host || channelType !== 2 || !channelId) return;
    void refresh(true);
    const unsubscribe = host.subscribe((target) => {
      if (!target || (target.channelId === channelId && target.channelType === channelType)) {
        void refresh(!target);
      }
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      if (alive.current === owner) alive.current = null;
      ++request.current;
      action.current = null;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [host, owner, channelId, channelType, refresh]);

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
      await (kind === "open" ? host.open(target) : host.manage(target));
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
