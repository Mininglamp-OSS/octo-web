import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type ConversationContext from "../../../Components/Conversation/context";
import { ScreenshotToolbar } from "./ScreenshotToolbar";
import { screenshotSettingsStore } from "./settings";
import type { ScreenshotRequest, ScreenshotResult } from "./contract";

vi.mock("../../../i18n", () => ({
  i18n: { getLocale: () => "en-US" }, useI18n: () => ({ t: (key: string) => key }),
}));
// Menu items render as role="menuitem" rather than a real <button> so the toolbar's own
// role="button" stays the only button in the tree for the assertions below.
vi.mock("@douyinfe/semi-ui", () => {
  const Dropdown = ({ children, render }: { children: React.ReactNode; render?: React.ReactNode }) =>
    <>{children}{render}</>;
  Dropdown.Menu = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Dropdown.Item = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    <div role="menuitem" onClick={onClick}>{children}</div>;
  return { Dropdown, Toast: { error: vi.fn() } };
});

function fixture() {
  let finish!: (result: ScreenshotResult) => void;
  const host = { captureScreenshot: vi.fn((_request: ScreenshotRequest) =>
      new Promise<ScreenshotResult>(resolve => { finish = resolve; })),
    cancelScreenshot: vi.fn(async () => {}) };
  const context = { channel: () => ({ channelType: 1, channelID: "user-1" }),
    addPendingAttachments: vi.fn(async () => null), messageInputContext: () => ({ focus: vi.fn() }),
  } as unknown as ConversationContext;
  return { host, context, finish: (result: ScreenshotResult) => finish(result) };
}
beforeEach(() => {
  window.localStorage.clear();
  screenshotSettingsStore.set({ hideChatWindow: false });
});
it("hides the button for browser and legacy hosts", () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={{}} conversation={f.context} scopeKey={() => "space"} />);
  expect(view.queryByRole("button")).toBeNull();
});
it("disables repeated clicks during capture and restores the action after cancellation", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("button"));
  expect(view.getByRole("button").getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(view.getByRole("button"));
  expect(f.host.captureScreenshot).toHaveBeenCalledOnce();
  await act(async () => f.finish({ status: "cancelled" }));
  await waitFor(() => expect(view.getByRole("button").getAttribute("aria-disabled")).toBe("false"));
  expect(f.context.addPendingAttachments).not.toHaveBeenCalled();
});
it("cancels its capture on unmount", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("button"));
  view.unmount();
  expect(f.host.cancelScreenshot).toHaveBeenCalledOnce();
  await act(async () => f.finish({ status: "cancelled" }));
});
it("keeps the chat window visible unless the menu option is checked", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("button"));
  expect(f.host.captureScreenshot.mock.calls[0][0]).toMatchObject({ hideChatWindow: false });
  await act(async () => f.finish({ status: "cancelled" }));
});
it("persists the hide-window option and applies it to the next capture", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("menuitem"));
  expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: true });
  fireEvent.click(view.getByRole("button"));
  expect(f.host.captureScreenshot.mock.calls[0][0]).toMatchObject({ hideChatWindow: true });
  await act(async () => f.finish({ status: "cancelled" }));
});
