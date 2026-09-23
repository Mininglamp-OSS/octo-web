import type {
  WorkspaceGroupAction, WorkspaceGroupHost, WorkspaceGroupTarget,
} from "@octo/base/src/features/workspaceGroup/contract";
import type { HostCommand, OctoBuddyCommunicationBridge } from "./hostBridge";
import WorkspaceGroupService from "@octo/base/src/Service/WorkspaceGroupService";

interface WorkspaceGroupSession {
  spaceId: string;
  uid: string;
  token: string;
  apiOrigin: string;
}

export function createWorkspaceGroupHost(
  bridge: OctoBuddyCommunicationBridge,
  getSession: () => WorkspaceGroupSession,
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
  const sameSession = (session: WorkspaceGroupSession) => {
    const current = getSession();
    return session.spaceId === current.spaceId && session.uid === current.uid
      && session.token === current.token && session.apiOrigin === current.apiOrigin;
  };
  const listeners = new Set<(target: WorkspaceGroupTarget | null) => void>();
  const guardAction = async (target: WorkspaceGroupAction, manage: boolean) => {
    if (!active()) throw new Error("Workspace host is inactive");
    const scope = revision;
    await (manage ? bridge.manageWorkspaceGroup!(target) : bridge.openGroupWorkspace!(target));
    if (scope !== revision) throw new Error("Workspace scope changed");
  };
  const host: WorkspaceGroupHost = {
    async getContext(target) {
      if (!active()) return null;
      const scope = revision;
      const session = getSession();
      if (!session.spaceId || !session.uid || !session.token) throw new Error("Workspace session unavailable");
      const controller = new AbortController();
      reads.add(controller);
      const isCurrent = () => scope === revision && active() && sameSession(session);
      try {
        const context = await WorkspaceGroupService.getContext(target, {
          spaceId: session.spaceId,
          signal: controller.signal,
          assertCurrent() {
            if (!isCurrent() || controller.signal.aborted) throw new Error("Workspace scope changed");
          },
        });
        return isCurrent() ? context : null;
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        reads.delete(controller);
      }
    },
    open: (target) => guardAction(target, false),
    manage: (target) => guardAction(target, true),
    subscribe(listener) {
      listeners.add(listener);
      const dispose = bridge.onWorkspaceGroupChanged?.((target) => {
        if (active() && target?.channelType === 2 && typeof target.channelId === "string") listener(target);
      });
      return () => { listeners.delete(listener); dispose?.(); };
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
        ++revision;
        for (const controller of reads) controller.abort();
        reads.clear();
        for (const listener of listeners) listener(null);
      }
    },
  };
}
