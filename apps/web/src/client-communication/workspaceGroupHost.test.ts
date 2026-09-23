import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceGroupHost as createHost } from "./workspaceGroupHost";
import type { OctoBuddyCommunicationBridge, HostCommand } from "./hostBridge";
import { WorkspaceGroupReadUnavailable, type WorkspaceGroupContext } from "@octo/base/src/features/workspaceGroup/contract";
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
let session = { spaceId: "space-a", sessionRevision: 1, ready: true, apiOrigin: "https://example.test" };
function createWorkspaceGroupHost(client: OctoBuddyCommunicationBridge) {
  return createHost(client, () => session);
}

describe("Client workspace group adapter", () => {
  beforeEach(() => {
    session = { spaceId: "space-a", sessionRevision: 1, ready: true, apiOrigin: "https://example.test" };
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
    await host!.getContext(target);
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
    await expect(pending).rejects.toBeInstanceOf(WorkspaceGroupReadUnavailable);
    expect(changed).toHaveBeenCalledWith(null);
  });

  it("does not query or act while hidden and re-enables lookup on resume", async () => {
    const client = bridge();
    const adapter = createWorkspaceGroupHost(client);
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: false });
    await expect(adapter.host!.getContext(target)).rejects.toMatchObject({ reason: "inactive" });
    await expect(adapter.host!.open({ ...target, projectId: "a" })).rejects.toThrow();
    expect(client.getWorkspaceGroupContext).not.toHaveBeenCalled();
    expect(WorkspaceGroupService.getContext).not.toHaveBeenCalled();
    expect(client.openGroupWorkspace).not.toHaveBeenCalled();
    adapter.handleCommand({ type: "resume" });
    await expect(adapter.host!.getContext(target)).rejects.toMatchObject({ reason: "inactive" });
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    expect(await adapter.host!.getContext(target)).toEqual(context);
  });

  it("window visibility cannot resume a suspended surface or revoke a logged-out scope", async () => {
    const client = bridge();
    const adapter = createWorkspaceGroupHost(client);
    adapter.handleCommand({ type: "suspend" });
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    await expect(adapter.host!.getContext(target)).rejects.toMatchObject({ reason: "inactive" });
    adapter.handleCommand({ type: "resume" });
    expect(await adapter.host!.getContext(target)).toEqual(context);
    adapter.handleCommand({ type: "sessionRevoked" });
    adapter.handleCommand({ type: "resume" });
    adapter.handleCommand({ type: "hostVisibilityChanged", visible: true });
    await expect(adapter.host!.getContext(target)).rejects.toMatchObject({ reason: "inactive" });
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

  const sessionChanges = [
    { sessionRevision: 2 }, { ready: false }, { spaceId: "space-b" }, { apiOrigin: "https://other.test" },
  ];
  it.each(sessionChanges)("rejects old responses after %j changes without a host notification", async (change) => {
    let finish!: (value: WorkspaceGroupContext) => void;
    vi.mocked(WorkspaceGroupService.getContext).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const adapter = createWorkspaceGroupHost(bridge());
    const pending = adapter.host!.getContext(target);
    const scope = vi.mocked(WorkspaceGroupService.getContext).mock.calls[0][1];
    session = { ...session, ...change };
    expect(() => scope.assertCurrent()).toThrow(WorkspaceGroupReadUnavailable);
    finish(context);
    await expect(pending).rejects.toMatchObject({ reason: "scope" });
  });

  it.each(sessionChanges)("blocks cached native actions after a silent %j change", async (change) => {
    const client = bridge();
    const { host } = createWorkspaceGroupHost(client);
    await host!.getContext(target);
    session = { ...session, ...change };
    const action = { ...target, projectId: context.projectId };
    await expect(host!.open(action)).rejects.toThrow("Workspace scope changed");
    await expect(host!.manage(action)).rejects.toThrow("Workspace scope changed");
    expect(client.openGroupWorkspace).not.toHaveBeenCalled();
    expect(client.manageWorkspaceGroup).not.toHaveBeenCalled();
  });

  it("guards action completion against silent session changes", async () => {
    const client = bridge();
    let finish!: () => void;
    vi.mocked(client.manageWorkspaceGroup!).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { host } = createWorkspaceGroupHost(client);
    await host!.getContext(target);
    const pending = host!.manage({ ...target, projectId: context.projectId });
    session = { ...session, sessionRevision: 2 };
    finish();
    await expect(pending).rejects.toThrow("Workspace scope changed");
  });

  it("snapshots sessions even when the provider mutates its object in place", async () => {
    const client = bridge();
    const { host } = createWorkspaceGroupHost(client);
    await host!.getContext(target);
    session.sessionRevision++;
    await expect(host!.manage({ ...target, projectId: context.projectId })).rejects.toThrow("Workspace scope changed");
    expect(client.manageWorkspaceGroup).not.toHaveBeenCalled();
  });

  it("forwards only whitelisted action fields", async () => {
    const client = bridge();
    const { host } = createWorkspaceGroupHost(client);
    await host!.getContext(target);
    await host!.manage({ ...target, projectId: context.projectId, token: "never-forward", canManage: true } as any);
    expect(client.manageWorkspaceGroup).toHaveBeenCalledExactlyOnceWith({ ...target, projectId: context.projectId });
  });

  it("cancels transport on caller abort and removes the listener after completion", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let finish!: (value: WorkspaceGroupContext) => void;
    vi.mocked(WorkspaceGroupService.getContext).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { host } = createWorkspaceGroupHost(bridge());
    const pending = host!.getContext(target, controller.signal);
    const scope = vi.mocked(WorkspaceGroupService.getContext).mock.calls[0][1];
    controller.abort();
    expect(scope.signal?.aborted).toBe(true);
    finish(context);
    await expect(pending).rejects.toMatchObject({ reason: "scope" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not issue reads when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createWorkspaceGroupHost(bridge()).host!.getContext(target, controller.signal))
      .rejects.toBeInstanceOf(WorkspaceGroupReadUnavailable);
    expect(WorkspaceGroupService.getContext).not.toHaveBeenCalled();
  });

  it("resumes a not-ready session via an app notification without polling", async () => {
    session = { ...session, ready: false };
    let notify!: () => void;
    const dispose = vi.fn();
    const subscribe = vi.fn((listener: () => void) => { notify = listener; return dispose; });
    const { host } = createHost(bridge(), () => session, subscribe);
    const changed = vi.fn();
    const unsubscribe = host!.subscribe(changed);
    await expect(host!.getContext(target)).rejects.toMatchObject({ reason: "session" });
    expect(WorkspaceGroupService.getContext).not.toHaveBeenCalled();
    notify();
    expect(changed).not.toHaveBeenCalled();
    session = { ...session, sessionRevision: 2, ready: true };
    notify();
    expect(changed).toHaveBeenCalledExactlyOnceWith(null);
    expect(await host!.getContext(target)).toEqual(context);
    unsubscribe();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps null exclusively for confirmed unlinked or inaccessible relations", async () => {
    vi.mocked(WorkspaceGroupService.getContext).mockResolvedValue(null);
    expect(await createWorkspaceGroupHost(bridge()).host!.getContext(target)).toBeNull();
  });

  it("coalesces the host space change and the following app notification", () => {
    let notify!: () => void;
    const adapter = createHost(bridge(), () => session, (listener) => { notify = listener; return () => {}; });
    const changed = vi.fn();
    const unsubscribe = adapter.host!.subscribe(changed);
    session.spaceId = "space-b";
    adapter.handleCommand({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
    notify();
    expect(changed).toHaveBeenCalledExactlyOnceWith(null);
    unsubscribe();
  });
});
