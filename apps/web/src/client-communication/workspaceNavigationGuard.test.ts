import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shared: {
    pendingAttachmentGuard: undefined as (() => boolean) | undefined,
    pendingAttachmentDiscard: undefined as (() => void | Promise<void>) | undefined,
  },
  confirm: vi.fn((_props: { onOk: () => Promise<void>; onCancel: () => void }) => ({
    destroy: vi.fn(), update: vi.fn(),
  })),
}));

vi.mock("@octo/base", () => ({
  WKApp: { shared: mocks.shared },
  t: (key: string) => key,
}));
vi.mock("@octo/base/src/Components/WKModal", () => ({ wkConfirm: mocks.confirm }));

import { createWorkspaceNavigationGuard } from "./workspaceNavigationGuard";

describe("workspace navigation attachment guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shared.pendingAttachmentGuard = undefined;
    mocks.shared.pendingAttachmentDiscard = undefined;
  });

  it("proceeds without a dialog when there are no pending attachments", () => {
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    guard.run(proceed);
    mocks.shared.pendingAttachmentGuard = () => true;
    guard.run(proceed);
    expect(proceed).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("reuses the existing warning and commits only once after confirmation", async () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    const discard = vi.fn();
    mocks.shared.pendingAttachmentDiscard = discard;
    guard.run(proceed, cancel);
    expect(proceed).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "base.chatPage.unsentAttachmentTitle",
      content: "base.chatPage.unsentAttachmentContent",
      okText: "base.chatPage.continueSwitch",
      cancelText: "base.common.cancel",
    }));
    const dialog = mocks.confirm.mock.calls[0][0];
    await dialog.onOk();
    await dialog.onOk();
    dialog.onCancel();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels without committing the target", async () => {
    const discard = vi.fn();
    mocks.shared.pendingAttachmentDiscard = discard;
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    guard.run(proceed, cancel);
    const dialog = mocks.confirm.mock.calls[0][0];
    dialog.onCancel();
    await dialog.onOk();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it("destroys replaced dialogs and ignores stale callbacks", async () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const oldProceed = vi.fn();
    const oldCancel = vi.fn();
    const proceed = vi.fn();
    guard.run(oldProceed, oldCancel);
    const oldDialog = mocks.confirm.mock.calls[0][0];
    const oldModal = mocks.confirm.mock.results[0].value;
    guard.run(proceed);
    expect(oldModal.destroy).toHaveBeenCalledTimes(1);
    await oldDialog.onOk();
    oldDialog.onCancel();
    expect(oldProceed).not.toHaveBeenCalled();
    expect(oldCancel).not.toHaveBeenCalled();
    await mocks.confirm.mock.calls[1][0].onOk();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("awaits cleanup but honors explicit navigation confirmation on persistent failure", async () => {
    const { Toast } = await import("@douyinfe/semi-ui");
    const notification = vi.spyOn(Toast, "error").mockImplementation(() => "toast");
    mocks.shared.pendingAttachmentGuard = () => false;
    let finish!: () => void;
    const discard = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mocks.shared.pendingAttachmentDiscard = discard;
    const proceed = vi.fn();
    createWorkspaceNavigationGuard().run(proceed);
    const dialog = mocks.confirm.mock.calls[0][0];
    const leaving = dialog.onOk();
    expect(proceed).not.toHaveBeenCalled();
    finish(); await leaving;
    expect(proceed).toHaveBeenCalledOnce();
    mocks.shared.pendingAttachmentDiscard = vi.fn().mockRejectedValue(new Error("disk"));
    createWorkspaceNavigationGuard().run(proceed);
    await mocks.confirm.mock.calls[1][0].onOk();
    await mocks.confirm.mock.calls[1][0].onOk();
    expect(proceed).toHaveBeenCalledTimes(2);
    expect(notification).toHaveBeenCalledOnce();
    notification.mockRestore();
  });

  it("invalidates pending callbacks on cleanup without navigating", async () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    guard.run(proceed, cancel);
    const dialog = mocks.confirm.mock.calls[0][0];
    guard.cancel();
    expect(mocks.confirm.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    await dialog.onOk();
    dialog.onCancel();
    expect(proceed).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each([false, true])("ignores UI cancellation while cleaning up and honors forced cancellation=%s", async forced => {
    mocks.shared.pendingAttachmentGuard = () => false;
    let release!: () => void;
    mocks.shared.pendingAttachmentDiscard = () => new Promise<void>(resolve => { release = resolve; });
    const guard = createWorkspaceNavigationGuard(), proceed = vi.fn(), cancel = vi.fn();
    guard.run(proceed, cancel);
    const dialog = mocks.confirm.mock.calls[0][0];
    const pending = dialog.onOk();
    expect(mocks.confirm.mock.results[0].value.update).toHaveBeenCalledWith({ maskClosable: false, closeOnEsc: false });
    dialog.onCancel();
    expect(cancel).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();
    if (forced) guard.cancel();
    release(); await pending;
    expect(proceed).toHaveBeenCalledTimes(forced ? 0 : 1);
  });

});
