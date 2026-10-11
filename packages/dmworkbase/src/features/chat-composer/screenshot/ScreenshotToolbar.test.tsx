import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type ConversationContext from "../../../Components/Conversation/context";
import { ScreenshotToolbar } from "./ScreenshotToolbar";
import { SCREENSHOT_MAX_BYTES } from "./capture";
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
  const addPendingAttachments = vi.fn(async (_files: File[], _source?: "paste" | "upload") => null as string | null);
  const context = { channel: () => ({ channelType: 1, channelID: "user-1" }),
    addPendingAttachments, messageInputContext: () => ({ focus: vi.fn() }),
  } as unknown as ConversationContext;
  return { host, context, addPendingAttachments, finish: (result: ScreenshotResult) => finish(result) };
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
// Pins the non-destructive integration: the "paste" source inserts an inline node at the live
// Tiptap selection, which would replace selected draft text or an inline attachment.
it("adds the capture through the non-destructive upload path, never as a pasted image", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("button"));
  await act(async () => f.finish({ status: "ok", bytes: new Uint8Array([137, 80, 78, 71]),
    filename: "screenshot.png", mimeType: "image/png", width: 1, height: 1 }));
  expect(f.addPendingAttachments).toHaveBeenCalledOnce();
  const [files, source] = f.addPendingAttachments.mock.calls[0];
  expect(source).toBe("upload");
  expect(files).toHaveLength(1);
  expect(files[0].name).toBe("screenshot.png");
});
it("surfaces a localized too-large error instead of a generic failure", async () => {
  const f = fixture();
  const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
  fireEvent.click(view.getByRole("button"));
  await act(async () => f.finish({ status: "ok", bytes: new Uint8Array(SCREENSHOT_MAX_BYTES + 1),
    filename: "huge.png", mimeType: "image/png", width: 8000, height: 8000 }));
  expect(f.context.addPendingAttachments).not.toHaveBeenCalled();
  const { Toast } = await import("@douyinfe/semi-ui");
  expect(Toast.error).toHaveBeenCalledWith("screenshot.too-large");
});
it("stays usable when crypto.randomUUID is unavailable", async () => {
  const original = crypto.randomUUID;
  // @ts-expect-error simulating a non-secure context where the API is absent
  crypto.randomUUID = undefined;
  try {
    const f = fixture();
    const view = render(<ScreenshotToolbar host={f.host} conversation={f.context} scopeKey={() => "space"} />);
    fireEvent.click(view.getByRole("button"));
    expect(f.host.captureScreenshot).toHaveBeenCalledOnce();
    expect(f.host.captureScreenshot.mock.calls[0][0].requestId).toBeTruthy();
    await act(async () => f.finish({ status: "cancelled" }));
  } finally { crypto.randomUUID = original; }
});
