import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRoster: vi.fn(),
  removeMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  destroyConfirm: vi.fn(),
  loginInfo: { uid: "me", token: "test-session" },
  shared: { currentSpaceId: "space-a", avatarUser: (uid: string) => `/avatar/${uid}` },
}));

vi.mock("@douyinfe/semi-ui", () => ({ Toast: { success: mocks.success, error: mocks.error } }));
vi.mock("../../WKModal", () => ({ wkConfirm: mocks.confirm }));
vi.mock("../../../App", () => ({
  default: { loginInfo: mocks.loginInfo, shared: mocks.shared },
}));
vi.mock("../../../Service/SpaceService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../Service/SpaceService")>();
  return { ...actual, SpaceService: { shared: mocks } };
});

import SpaceMembers from "../index";
import type { Space, SpaceMember } from "../../../Service/SpaceService";
import { i18n } from "../../../i18n";

function space(role = 2, spaceId = "space-a"): Space {
  return { space_id: spaceId, name: spaceId, description: "", logo: "", member_count: 2, max_users: 0, role, created_at: "" };
}

function member(uid: string, role = 0): SpaceMember {
  return { uid, name: uid, avatar: "", role, robot: 0, created_at: "" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPanel(role = 2, spaceId = "space-a") {
  const ref = React.createRef<SpaceMembers>();
  const onClose = vi.fn();
  const view = render(<SpaceMembers ref={ref} space={space(role, spaceId)} onClose={onClose} />);
  return { ...view, ref, onClose, switchSpace: (id: string) => {
    mocks.shared.currentSpaceId = id;
    view.rerender(<SpaceMembers ref={ref} space={space(role, id)} onClose={onClose} />);
  } };
}

interface RemovalPrompt {
  title: string;
  content: string;
  okType: string;
  okText: string;
  cancelText: string;
  onOk: () => void | Promise<void>;
  onCancel: () => void;
}

function removalPrompt(): RemovalPrompt {
  const prompt: RemovalPrompt | undefined = mocks.confirm.mock.lastCall?.[0];
  if (!prompt) throw new Error("No removal confirmation was opened");
  return prompt;
}

function confirmRemoval() {
  let result: void | Promise<void> = undefined;
  act(() => { result = removalPrompt().onOk(); });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRoster.mockReset().mockResolvedValue([member("target")]);
  mocks.removeMembers.mockReset().mockResolvedValue(undefined);
  mocks.updateMemberRole.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockReturnValue({ destroy: mocks.destroyConfirm });
  mocks.loginInfo.uid = "me";
  mocks.loginInfo.token = "test-session";
  mocks.shared.currentSpaceId = "space-a";
  i18n.setLocale("en-US", { notify: false, persist: false });
});

const roles = [0, 1, 2, -1, 99, NaN];
const roleCases = roles.flatMap((operator) => roles.map((target) => ({
  operator, target,
  allowed: (operator === 2 && (target === 0 || target === 1)) || (operator === 1 && target === 0),
})));

describe("SpaceMembers removal confirmation", () => {
  it("requires confirmation before sending a destructive removal", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    expect(mocks.removeMembers).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(removalPrompt()).toMatchObject({
      title: "Remove member?",
      content: 'Remove "target" from this organization? Their group and project memberships will also be removed. This cannot be undone.',
      okType: "danger", okText: "Remove", cancelText: "Cancel",
    });
  });

  it("cancels removal without sending a request and unlocks the row", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    act(() => { removalPrompt().onCancel(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
    expect(screen.getByText("target")).toBeInTheDocument();
  });

  it("localizes the member name and irreversible consequences in Chinese", async () => {
    i18n.setLocale("zh-CN", { notify: false, persist: false });
    mocks.getRoster.mockResolvedValue([{ ...member("target"), name: "测试成员" }]);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "移除", exact: true }));
    expect(removalPrompt()).toMatchObject({
      title: "移除成员？", okText: "移除", cancelText: "取消", okType: "danger",
      content: "确定将“测试成员”移出组织吗？该成员在组织内的群组和项目成员关系也将被清理，此操作无法撤销。",
    });
  });

  it("blocks overlapping confirmations and role writes until cancellation", async () => {
    const { ref } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    await act(async () => {
      ref.current?.handleRemove("target");
      await ref.current?.handleRoleChange("target", 1);
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.removeMembers).not.toHaveBeenCalled();
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Set as admin" })).toBeDisabled();
    act(() => { removalPrompt().onCancel(); });
    expect(screen.getByRole("button", { name: "Set as admin" })).toBeEnabled();
  });

  it.each(["uid", "token", "active space"])("rejects confirmation after the %s changes without a render", async (change) => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    if (change === "uid") mocks.loginInfo.uid = "another-user";
    if (change === "token") mocks.loginInfo.token = "another-session";
    if (change === "active space") mocks.shared.currentSpaceId = "space-b";
    await act(async () => { await removalPrompt().onOk(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
  });

  it.each(["role", "missing"])("rechecks a target whose state changed: %s", async (change) => {
    const { ref } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    act(() => { ref.current?.setState({ members: change === "role" ? [member("target", 1)] : [] }); });
    await act(async () => { await removalPrompt().onOk(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });

  it("dismisses the prompt on an operator role change and ignores its old confirmation", async () => {
    const { ref, rerender } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    const prompt = removalPrompt();
    rerender(<SpaceMembers ref={ref} space={space(1)} onClose={vi.fn()} />);
    expect(mocks.destroyConfirm).toHaveBeenCalledOnce();
    await act(async () => { await prompt.onOk(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });

  it("checks the captured operator role even when the same Space object was updated in place", async () => {
    const { ref } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    if (!ref.current) throw new Error("Member panel was not mounted");
    ref.current.props.space.role = 1;
    await act(async () => { await removalPrompt().onOk(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });

  it.each(["close", "unmount", "space switch"])("dismisses the prompt safely on %s", async (change) => {
    const { container, unmount, switchSpace, onClose } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    const prompt = removalPrompt();
    if (change === "close") {
      const back = container.querySelector(".wk-spacemembers-back");
      if (!back) throw new Error("Back control was not rendered");
      fireEvent.click(back);
      expect(onClose).toHaveBeenCalledOnce();
    }
    if (change === "unmount") unmount();
    if (change === "space switch") switchSpace("space-b");
    expect(mocks.destroyConfirm).toHaveBeenCalledOnce();
    await act(async () => { await prompt.onOk(); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });

  it("keeps a replacement prompt locked when a cancelled prompt invokes old callbacks", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    const oldPrompt = removalPrompt();
    act(() => { oldPrompt.onCancel(); });
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
    await act(async () => { oldPrompt.onCancel(); await oldPrompt.onOk(); });
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.removeMembers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    act(() => { removalPrompt().onCancel(); });
  });

  it("submits only once and prevents close or another action while the confirmed write is pending", async () => {
    const write = deferred<void>();
    mocks.removeMembers.mockReturnValue(write.promise);
    const { ref, onClose } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    const prompt = removalPrompt();
    const pending = confirmRemoval();
    await act(async () => {
      await prompt.onOk();
      prompt.onCancel();
      ref.current?.handleClose();
      ref.current?.handleRemove("target");
      await ref.current?.handleRoleChange("target", 1);
    });
    expect(mocks.removeMembers).toHaveBeenCalledExactlyOnceWith("space-a", ["target"]);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    await act(async () => { write.resolve(); await pending; });
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
  });
});

describe("SpaceMembers roster load failure", () => {
  it("shows an explicit error with retry instead of an empty member list", async () => {
    const retried = deferred<SpaceMember[]>();
    mocks.getRoster.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(retried.promise);
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load members. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    await act(async () => { retried.resolve([member("retried-member")]); });
    expect(screen.getByText("retried-member")).toBeInTheDocument();
    expect(mocks.getRoster).toHaveBeenNthCalledWith(2, "space-a", { maxAgeMs: 0 });
  });

  it("does not label an authoritative empty roster as a failed load", async () => {
    mocks.getRoster.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("SpaceMembers role hierarchy", () => {
  it.each(roleCases)("operator $operator and target $target: remove allowed=$allowed", async ({ operator, target, allowed }) => {
    mocks.getRoster.mockResolvedValue([member("target", target)]);
    const { ref } = renderPanel(operator);
    await screen.findByText("target");

    expect(screen.queryByRole("button", { name: "Remove", exact: true }) !== null).toBe(allowed);
    expect(screen.queryByRole("button", { name: /^(Set as admin|Remove admin)$/ }) !== null).toBe(operator === 2 && allowed);
    if (!allowed) {
      await act(async () => { await ref.current?.handleRemove("target"); });
      expect(mocks.removeMembers).not.toHaveBeenCalled();
    }
  });

  it.each([0, 1, 2])("never offers or executes removal of self with role %s", async (role) => {
    mocks.getRoster.mockResolvedValue([member("me", role)]);
    const { ref } = renderPanel(role);
    await screen.findByText("me");
    expect(screen.queryByRole("button", { name: "Remove", exact: true })).not.toBeInTheDocument();
    await act(async () => { await ref.current?.handleRemove("me"); });
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });

  it("fails closed when the current user identity is unavailable", async () => {
    mocks.loginInfo.uid = "";
    renderPanel();
    await screen.findByText("target");
    expect(screen.queryByRole("button", { name: "Remove", exact: true })).not.toBeInTheDocument();
  });

  it("rejects forged role commands for admins, unknown roles and owner promotion", async () => {
    const { ref, rerender } = renderPanel(1);
    await screen.findByText("target");
    await act(async () => { await ref.current?.handleRoleChange("target", 1); });
    rerender(<SpaceMembers ref={ref} space={space(2)} onClose={vi.fn()} />);
    await act(async () => {
      await ref.current?.handleRoleChange("target", 2);
      await ref.current?.handleRoleChange("target", -1);
      await ref.current?.handleRemove("missing");
    });
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
    expect(mocks.removeMembers).not.toHaveBeenCalled();
  });
});

describe("SpaceMembers authoritative mutation results", () => {
  it("retains a target and reports failure when HTTP success did not remove it", async () => {
    // The target became an admin after the operator's initial member roster.
    mocks.getRoster.mockResolvedValueOnce([member("target")]).mockResolvedValueOnce([member("target", 1)]);
    renderPanel(1);
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    confirmRemoval();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Failed to remove"));

    expect(mocks.removeMembers).toHaveBeenCalledWith("space-a", ["target"]);
    expect(mocks.getRoster).toHaveBeenNthCalledWith(2, "space-a", { maxAgeMs: 0 });
    expect(screen.getByText("target")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove", exact: true })).not.toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("waits for fresh roster absence before reporting successful removal", async () => {
    const roster = deferred<SpaceMember[]>();
    mocks.getRoster.mockResolvedValueOnce([member("target")]).mockReturnValueOnce(roster.promise);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    confirmRemoval();
    await waitFor(() => expect(mocks.getRoster).toHaveBeenCalledTimes(2));
    expect(screen.getByText("target")).toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();

    await act(async () => { roster.resolve([member("other")]); });
    expect(screen.queryByText("target")).not.toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("Member removed");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["write", "verification"])("retains the roster when the %s request fails", async (stage) => {
    if (stage === "write") mocks.removeMembers.mockRejectedValue(new Error("unavailable"));
    else mocks.getRoster.mockResolvedValueOnce([member("target")]).mockRejectedValueOnce(new Error("unavailable"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    confirmRemoval();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Failed to remove"));
    expect(screen.getByText("target")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([{ result: 1, confirmed: true }, { result: 0, confirmed: false }, { result: 2, confirmed: false }])(
    "confirms requested admin role against fresh roster role $result", async ({ result, confirmed }) => {
      mocks.getRoster.mockResolvedValueOnce([member("target")]).mockResolvedValueOnce([member("target", result)]);
      renderPanel();
      fireEvent.click(await screen.findByRole("button", { name: "Set as admin" }));
      await waitFor(() => expect(confirmed ? mocks.success : mocks.error).toHaveBeenCalledWith(confirmed ? "Role updated" : "Failed to update role"));
      expect(mocks.updateMemberRole).toHaveBeenCalledWith("space-a", "target", 1);
      expect(mocks.getRoster).toHaveBeenNthCalledWith(2, "space-a", { maxAgeMs: 0 });
      expect(confirmed ? mocks.error : mocks.success).not.toHaveBeenCalled();
    }
  );

  it("prevents overlapping writes until verification completes", async () => {
    const write = deferred<void>();
    mocks.removeMembers.mockReturnValue(write.promise);
    const { ref } = renderPanel();
    await screen.findByText("target");
    act(() => { ref.current?.handleRemove("target"); });
    const pending = confirmRemoval();
    await act(async () => { await ref.current?.handleRoleChange("target", 1); });
    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
    await act(async () => { write.resolve(); await pending; });
  });
});

describe("SpaceMembers stale asynchronous completion", () => {
  it("ignores an old initial roster after switching spaces", async () => {
    const old = deferred<SpaceMember[]>();
    mocks.getRoster.mockReturnValueOnce(old.promise).mockResolvedValueOnce([member("new-member")]);
    const { switchSpace } = renderPanel();
    switchSpace("space-b");
    await screen.findByText("new-member");
    await act(async () => { old.resolve([member("old-member")]); });
    expect(screen.getByText("new-member")).toBeInTheDocument();
    expect(screen.queryByText("old-member")).not.toBeInTheDocument();
  });

  it.each(["remove", "role"])("ignores an old %s write after switching spaces", async (operation) => {
    const write = deferred<void>();
    mocks.removeMembers.mockReturnValue(write.promise);
    mocks.updateMemberRole.mockReturnValue(write.promise);
    mocks.getRoster.mockResolvedValueOnce([member("target")]).mockResolvedValueOnce([member("new-member")]);
    const { switchSpace } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: operation === "remove" ? "Remove" : "Set as admin", exact: true }));
    if (operation === "remove") confirmRemoval();
    switchSpace("space-b");
    await screen.findByText("new-member");
    await act(async () => { write.resolve(); });
    expect(mocks.getRoster).toHaveBeenCalledTimes(2);
    expect(screen.getByText("new-member")).toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("ignores a stale verification even after switching away and back to the same space", async () => {
    const old = deferred<SpaceMember[]>();
    mocks.getRoster.mockResolvedValueOnce([member("target")]).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([member("b-member")]).mockResolvedValueOnce([member("returned-member")]);
    const { switchSpace } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    confirmRemoval();
    await waitFor(() => expect(mocks.getRoster).toHaveBeenCalledTimes(2));
    switchSpace("space-b");
    await screen.findByText("b-member");
    switchSpace("space-a");
    await screen.findByText("returned-member");
    await act(async () => { old.resolve([]); });
    expect(screen.getByText("returned-member")).toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("suppresses failure notifications after unmount", async () => {
    const write = deferred<void>();
    mocks.removeMembers.mockReturnValue(write.promise);
    const { unmount } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Remove", exact: true }));
    confirmRemoval();
    unmount();
    await act(async () => { write.reject(new Error("late failure")); });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
