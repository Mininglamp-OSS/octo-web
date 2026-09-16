import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shared: { pendingAttachmentGuard: undefined as (() => boolean) | undefined },
  confirm: vi.fn((_props: { onOk: () => void; onCancel: () => void }) => ({
    destroy: vi.fn(),
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

  it("reuses the existing warning and commits only once after confirmation", () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    guard.run(proceed, cancel);
    expect(proceed).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "base.chatPage.unsentAttachmentTitle",
      content: "base.chatPage.unsentAttachmentContent",
      okText: "base.chatPage.continueSwitch",
      cancelText: "base.common.cancel",
    }));
    const dialog = mocks.confirm.mock.calls[0][0];
    dialog.onOk();
    dialog.onOk();
    dialog.onCancel();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels without committing the target", () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    guard.run(proceed, cancel);
    const dialog = mocks.confirm.mock.calls[0][0];
    dialog.onCancel();
    dialog.onOk();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled();
  });

  it("destroys replaced dialogs and ignores stale callbacks", () => {
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
    oldDialog.onOk();
    oldDialog.onCancel();
    expect(oldProceed).not.toHaveBeenCalled();
    expect(oldCancel).not.toHaveBeenCalled();
    mocks.confirm.mock.calls[1][0].onOk();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("invalidates pending callbacks on cleanup without navigating", () => {
    mocks.shared.pendingAttachmentGuard = () => false;
    const guard = createWorkspaceNavigationGuard();
    const proceed = vi.fn();
    const cancel = vi.fn();
    guard.run(proceed, cancel);
    const dialog = mocks.confirm.mock.calls[0][0];
    guard.cancel();
    expect(mocks.confirm.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    dialog.onOk();
    dialog.onCancel();
    expect(proceed).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
