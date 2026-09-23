import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceGroupHost as createHost } from "./workspaceGroupHost";
import type { OctoBuddyCommunicationBridge, HostCommand } from "./hostBridge";
import type { WorkspaceGroupContext } from "@octo/base/src/features/workspaceGroup/contract";
import WorkspaceGroupService from "@octo/base/src/Service/WorkspaceGroupService";

vi.mock("@octo/base/src/Service/WorkspaceGroupService", () => ({
  default: { getContext: vi.fn() },
}));

const target = { channelId: "group-a", channelType: 2 as const };
const context: WorkspaceGroupContext = {
  ...target, projectId: "project-a", projectName: "A", groupName: "Group", linkedByName: "Evan",
  source: "linked_existing", canOpen: true, canManage: true, isAllMemberGroup: false,
};
function bridge() {
  return {
    getWorkspaceGroupContext: vi.fn(async () => context),
    openGroupWorkspace: vi.fn(async () => {}),
    manageWorkspaceGroup: vi.fn(async () => {}),
  } as unknown as OctoBuddyCommunicationBridge;
}
let session = { spaceId: "space-a", uid: "user-a", token: "token-a", apiOrigin: "https://example.test" };
function createWorkspaceGroupHost(client: OctoBuddyCommunicationBridge) {
  return createHost(client, () => session);
}

describe("Client workspace group adapter", () => {
  beforeEach(() => {
    session = { spaceId: "space-a", uid: "user-a", token: "token-a", apiOrigin: "https://example.test" };
    vi.mocked(WorkspaceGroupService.getContext).mockReset().mockResolvedValue(context);
  });

  it.each(["openGroupWorkspace", "manageWorkspaceGroup"] as const)(
    "hides the capability when %s is missing", (method) => {
      const client = bridge();
      delete client[method];
      expect(createWorkspaceGroupHost(client).host).toBeNull();
    },
  );

  it("does not mistake cached group metadata or the workspace presentation for capability", () => {
    expect(createWorkspaceGroupHost({} as OctoBuddyCommunicationBridge).host).toBeNull();
  });

  it("maps actions without passing organization or session data", async () => {
    const client = bridge();
    const { host } = createWorkspaceGroupHost(client);
    await host!.getContext(target);
    const action = { ...target, projectId: "project-a" };
    await host!.open(action);
    await host!.manage(action);
    expect(client.getWorkspaceGroupContext).not.toHaveBeenCalled();
    expect(WorkspaceGroupService.getContext).toHaveBeenCalledWith(target, expect.objectContaining({
      spaceId: "space-a", signal: expect.any(AbortSignal), assertCurrent: expect.any(Function),
    }));
    expect(client.openGroupWorkspace).toHaveBeenCalledWith(action);
    expect(client.manageWorkspaceGroup).toHaveBeenCalledWith(action);
  });

  it("queries directly from Web even when the legacy Client query IPC is absent", async () => {
    const client = bridge();
    delete client.getWorkspaceGroupContext;
    expect(await createWorkspaceGroupHost(client).host!.getContext(target)).toEqual(context);
    expect(WorkspaceGroupService.getContext).toHaveBeenCalledOnce();
  });

  it("preserves Web-resolved actor presentation on native management actions", async () => {
    const client = bridge();
    const { host } = createWorkspaceGroupHost(client);
    const action = {
      ...target, projectId: "project-a",
      presentation: { linkedBy: "user-2", linkedByName: "Evan" },
    };
    await host!.manage(action);
    expect(client.manageWorkspaceGroup).toHaveBeenCalledExactlyOnceWith(action);
    expect(client.getWorkspaceGroupContext).not.toHaveBeenCalled();
  });

  it.each([
    { type: "spaceChanged", space: { id: "space-b", name: "B" } },
    { type: "suspend" },
    { type: "sessionRevoked" },
    { type: "hostVisibilityChanged", visible: false },
  ] satisfies HostCommand[])("invalidates delayed responses on %j", async (command) => {
    const client = bridge();
    let finish!: (value: WorkspaceGroupContext) => void;
    vi.mocked(WorkspaceGroupService.getContext).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const adapter = createWorkspaceGroupHost(client);
    const changed = vi.fn();
    adapter.host!.subscribe(changed);
    const pending = adapter.host!.getContext(target);
    adapter.handleCommand(command);
    expect(vi.mocked(WorkspaceGroupService.getContext).mock.calls[0][1].signal?.aborted).toBe(true);
    finish(context);
    expect(await pending).toBeNull();
    expect(changed).toHaveBeenCalledWith(null);
  });

  it("does not query or act while hidden and re-enables lookup on resume", async () => {
    const client = bridge();
    const adapter = createWorkspaceGroupHost(client);
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: false });
    expect(await adapter.host!.getContext(target)).toBeNull();
    await expect(adapter.host!.open({ ...target, projectId: "a" })).rejects.toThrow();
    expect(client.getWorkspaceGroupContext).not.toHaveBeenCalled();
    expect(WorkspaceGroupService.getContext).not.toHaveBeenCalled();
    expect(client.openGroupWorkspace).not.toHaveBeenCalled();
    adapter.handleCommand({ type: "resume" });
    expect(await adapter.host!.getContext(target)).toBeNull();
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    expect(await adapter.host!.getContext(target)).toEqual(context);
  });

  it("window visibility cannot resume a suspended surface or revoke a logged-out scope", async () => {
    const client = bridge();
    const adapter = createWorkspaceGroupHost(client);
    adapter.handleCommand({ type: "suspend" });
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    expect(await adapter.host!.getContext(target)).toBeNull();
    adapter.handleCommand({ type: "resume" });
    expect(await adapter.host!.getContext(target)).toEqual(context);
    adapter.handleCommand({ type: "sessionRevoked" });
    adapter.handleCommand({ type: "resume" });
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    expect(await adapter.host!.getContext(target)).toBeNull();
  });

  it("duplicate visibility events do not clear an already visible entry", () => {
    const adapter = createWorkspaceGroupHost(bridge());
    const listener = vi.fn();
    adapter.host!.subscribe(listener);
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes relation notifications without adding another host command listener", () => {
    const client = bridge();
    const dispose = vi.fn();
    client.onWorkspaceGroupChanged = vi.fn(() => dispose);
    const adapter = createWorkspaceGroupHost(client);
    const listener = vi.fn();
    const unsubscribe = adapter.host!.subscribe(listener);
    unsubscribe();
    adapter.handleCommand({ type: "suspend" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(["uid", "token", "spaceId", "apiOrigin"] as const)("rejects old responses after %s changes without a host notification", async (key) => {
    let finish!: (value: WorkspaceGroupContext) => void;
    vi.mocked(WorkspaceGroupService.getContext).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const adapter = createWorkspaceGroupHost(bridge());
    const pending = adapter.host!.getContext(target);
    const scope = vi.mocked(WorkspaceGroupService.getContext).mock.calls[0][1];
    session = { ...session, [key]: "changed" };
    expect(() => scope.assertCurrent()).toThrow("Workspace scope changed");
    finish(context);
    expect(await pending).toBeNull();
  });
});
