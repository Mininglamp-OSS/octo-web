import {
  WorkspaceGroupReadUnavailable, type WorkspaceGroupAction, type WorkspaceGroupHost, type WorkspaceGroupTarget,
} from "@octo/base/src/features/workspaceGroup/contract";
import type { HostCommand, OctoBuddyCommunicationBridge } from "./hostBridge";
import WorkspaceGroupService from "@octo/base/src/Service/WorkspaceGroupService";

interface WorkspaceGroupSession {
  spaceId: string;
  sessionRevision: number;
  ready: boolean;
  apiOrigin: string;
}

export function createWorkspaceGroupHost(
  bridge: OctoBuddyCommunicationBridge,
  getSession: () => WorkspaceGroupSession,
  subscribeSession?: (listener: () => void) => () => void,
): {
  host: WorkspaceGroupHost | null;
  handleCommand(command: HostCommand): void;
} {
  if (!bridge.openGroupWorkspace || !bridge.manageWorkspaceGroup) {
    return { host: null, handleCommand: () => {} };
  }
  let revision = 0;
  let suspended = false;
  let windowVisible = true;
  let revoked = false;
  const active = () => !suspended && windowVisible && !revoked;
  const reads = new Set<AbortController>();
  const verifiedActions = new Map<string, { projectId: string; session: WorkspaceGroupSession; revision: number }>();
  const sameSession = (session: WorkspaceGroupSession) => {
    const current = getSession();
    return session.spaceId === current.spaceId && session.sessionRevision === current.sessionRevision
      && session.ready === current.ready && session.apiOrigin === current.apiOrigin;
  };
  const listeners = new Set<(target: WorkspaceGroupTarget | null) => void>();
  let observedSession: WorkspaceGroupSession | undefined;
  const invalidate = () => {
    observedSession = { ...getSession() };
    ++revision;
    verifiedActions.clear();
    for (const controller of reads) controller.abort();
    reads.clear();
    for (const listener of listeners) listener(null);
  };
  const guardAction = async (target: WorkspaceGroupAction, manage: boolean) => {
    if (!active()) throw new Error("Workspace host is inactive");
    const verified = verifiedActions.get(target.channelId);
    if (target.channelType !== 2 || !verified || verified.projectId !== target.projectId || verified.revision !== revision
        || !sameSession(verified.session)) throw new Error("Workspace scope changed");
    const scope = revision;
    const action: WorkspaceGroupAction = {
      channelId: target.channelId, channelType: 2, projectId: target.projectId,
      ...(manage && target.presentation ? { presentation: {
        linkedBy: target.presentation.linkedBy, linkedByName: target.presentation.linkedByName,
      } } : {}),
    };
    await (manage ? bridge.manageWorkspaceGroup!(action) : bridge.openGroupWorkspace!(action));
    if (scope !== revision || !sameSession(verified.session)) throw new Error("Workspace scope changed");
  };
  let unsubscribeSession: (() => void) | undefined;
  const host: WorkspaceGroupHost = {
    async getContext(target, signal) {
      if (!active()) throw new WorkspaceGroupReadUnavailable("inactive");
      const scope = revision;
      const session = { ...getSession() };
      if (!session.spaceId || !session.ready) throw new WorkspaceGroupReadUnavailable("session");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      reads.add(controller);
      const isCurrent = () => scope === revision && active() && sameSession(session) && !controller.signal.aborted;
      try {
        if (!isCurrent()) throw new WorkspaceGroupReadUnavailable("scope");
        const context = await WorkspaceGroupService.getContext(target, {
          spaceId: session.spaceId,
          signal: controller.signal,
          assertCurrent() {
            if (!isCurrent()) throw new WorkspaceGroupReadUnavailable("scope");
          },
        });
        if (!isCurrent()) throw new WorkspaceGroupReadUnavailable("scope");
        if (context) verifiedActions.set(target.channelId, { projectId: context.projectId, session, revision: scope });
        else verifiedActions.delete(target.channelId);
        return context;
      } catch (error) {
        if (!isCurrent()) throw new WorkspaceGroupReadUnavailable(active() ? "scope" : "inactive");
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        reads.delete(controller);
      }
    },
    open: (target) => guardAction(target, false),
    manage: (target) => guardAction(target, true),
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && subscribeSession) {
        observedSession = { ...getSession() };
        unsubscribeSession = subscribeSession(() => {
          if (observedSession && sameSession(observedSession)) return;
          invalidate();
        });
      }
      const dispose = bridge.onWorkspaceGroupChanged?.((target) => {
        if (active() && target?.channelType === 2 && typeof target.channelId === "string") listener(target);
      });
      return () => {
        listeners.delete(listener);
        dispose?.();
        if (!listeners.size) {
          unsubscribeSession?.();
          unsubscribeSession = undefined;
          observedSession = undefined;
          verifiedActions.clear();
        }
      };
    },
  };
  return {
    host,
    handleCommand(command) {
      if (command.type === "spaceChanged" || command.type === "sessionRevoked" ||
          command.type === "suspend" || command.type === "resume" || command.type === "hostVisibilityChanged") {
        const wasActive = active();
        if (command.type === "sessionRevoked") revoked = true;
        if (command.type === "suspend") suspended = true;
        if (command.type === "resume") suspended = false;
        if (command.type === "hostVisibilityChanged") windowVisible = command.visible;
        if (wasActive === active() && command.type !== "spaceChanged" && command.type !== "sessionRevoked") return;
        invalidate();
      }
    },
  };
}
