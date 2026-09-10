import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal, Toast } from "@douyinfe/semi-ui";

const service = vi.hoisted(() => ({ getRoster: vi.fn(), removeMembers: vi.fn() }));
vi.mock("../../../App", () => ({
  default: {
    loginInfo: { uid: "me", token: "test-session" },
    shared: { currentSpaceId: "space-a", avatarUser: (uid: string) => `/avatar/${uid}` },
  },
}));
vi.mock("../../../Service/SpaceService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../Service/SpaceService")>();
  return { ...actual, SpaceService: { shared: service } };
});

import SpaceMembers from "../index";
import { i18n } from "../../../i18n";

const realConfirm = Modal.confirm;

beforeEach(() => {
  i18n.setLocale("en-US", { notify: false, persist: false });
  service.getRoster.mockReset().mockResolvedValue([
    { uid: "target", name: "Target member", role: 0, avatar: "", robot: 0, created_at: "" },
  ]);
  service.removeMembers.mockReset().mockResolvedValue(undefined);
  vi.spyOn(Toast, "success").mockImplementation(() => "toast");
  vi.spyOn(Toast, "error").mockImplementation(() => "toast");
  // jsdom does not run the CSS animation that normally completes destruction.
  vi.spyOn(Modal, "confirm").mockImplementation((options) => realConfirm({ ...options, motion: false }));
});

afterEach(() => {
  act(() => { Modal.destroyAll(); });
  vi.restoreAllMocks();
});

it.each(["English", "Chinese"])("uses the real danger confirmation in %s: Cancel sends no request, Confirm verifies removal", async (language) => {
  i18n.setLocale(language === "English" ? "en-US" : "zh-CN", { notify: false, persist: false });
  const remove = language === "English" ? "Remove" : "移除";
  const cancel = language === "English" ? "Cancel" : "取消";
  render(<SpaceMembers
    space={{ space_id: "space-a", name: "Space A", role: 2, description: "", logo: "", member_count: 2, max_users: 0, created_at: "" }}
    onClose={vi.fn()}
  />);
  fireEvent.click(await screen.findByRole("button", { name: remove, exact: true }));
  const firstDialog = await screen.findByRole("dialog");
  expect(within(firstDialog).getByText(/Target member.*(group and project memberships|群组和项目)/)).toBeInTheDocument();
  expect(within(firstDialog).getByRole("button", { name: remove, exact: true })).toHaveClass("wk-btn--danger");
  expect(service.removeMembers).not.toHaveBeenCalled();
  fireEvent.click(within(firstDialog).getByRole("button", { name: cancel }));
  await waitFor(() => expect(firstDialog).not.toBeInTheDocument());
  expect(service.removeMembers).not.toHaveBeenCalled();

  service.getRoster.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: remove, exact: true }));
  const secondDialog = await screen.findByRole("dialog");
  fireEvent.click(within(secondDialog).getByRole("button", { name: remove, exact: true }));
  await waitFor(() => expect(Toast.success).toHaveBeenCalledWith(language === "English" ? "Member removed" : "已移除成员"));
  expect(service.removeMembers).toHaveBeenCalledExactlyOnceWith("space-a", ["target"]);
  expect(service.getRoster).toHaveBeenLastCalledWith("space-a", { maxAgeMs: 0 });
  await waitFor(() => expect(secondDialog).not.toBeInTheDocument());
  expect(screen.queryByText("Target member")).not.toBeInTheDocument();
});
