import type {
  WorkspaceGroupAction, WorkspaceGroupHost, WorkspaceGroupTarget,
} from "@octo/base/src/features/workspaceGroup/contract";
import type { HostCommand, OctoBuddyCommunicationBridge } from "./hostBridge";

export function createWorkspaceGroupHost(bridge: OctoBuddyCommunicationBridge): {
  host: WorkspaceGroupHost | null;
  handleCommand(command: HostCommand): void;
} {
  if (!bridge.getWorkspaceGroupContext || !bridge.openGroupWorkspace || !bridge.manageWorkspaceGroup) {
    return { host: null, handleCommand: () => {} };
  }
  let revision = 0;
  let suspended = false;
  let windowVisible = true;
  let revoked = false;
  const active = () => !suspended && windowVisible && !revoked;
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
      const context = await bridge.getWorkspaceGroupContext!(target);
      return scope === revision && active() ? context : null;
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
        for (const listener of listeners) listener(null);
      }
    },
  };
}
