import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  layout: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  closed: undefined as undefined | ((id: string) => void),
  state: undefined as undefined | ((state: unknown) => void),
  accepted: undefined as undefined | (() => void),
}));
vi.mock("./attachmentHost", () => ({
  updateHostAttachmentLayout: bridge.layout,
  releaseHostAttachmentPreview: bridge.release,
  subscribeHostAttachmentClosed: (listener: typeof bridge.closed) => {
    bridge.closed = listener; return () => { bridge.closed = undefined; };
  },
  subscribeHostAttachmentState: (listener: typeof bridge.state) => {
    bridge.state = listener; return () => { bridge.state = undefined; };
  },
  subscribeHostAttachmentPreview: (listener: typeof bridge.accepted) => {
    bridge.accepted = listener; return () => { bridge.accepted = undefined; };
  },
}));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => <span>Loading</span>,
  Button: ({ theme, icon, ...props }: any) => <button {...props}>{icon}</button>,
}));
vi.mock("@douyinfe/semi-icons", () => ({ IconClose: () => <span />, IconRefresh: () => <span /> }));

import { HostFilePreviewSlot, measureHostPreviewSlot } from "./HostFilePreviewSlot";

const rect = (x = 50, y = 20, width = 320, height = 600) =>
  ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} });
let resize: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = async () => { await act(async () => { vi.advanceTimersByTime(500); }); };

describe("native file preview slot", () => {
  it("reports geometry, resends after acceptance and resize, then hides on cleanup", async () => {
    const view = render(<HostFilePreviewSlot requestId="active" onClose={vi.fn()} />);
    await flush();
    expect(bridge.layout).toHaveBeenLastCalledWith({
      version: 1, requestId: "active", visible: true,
      bounds: { x: 50, y: 20, width: 320, height: 600 },
    });
    bridge.layout.mockClear();
    act(() => { bridge.accepted?.(); });
    await flush();
    expect(bridge.layout).toHaveBeenCalledOnce();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(rect(80, 20, 400));
    act(() => { resize(); });
    await flush();
    expect(bridge.layout).toHaveBeenLastCalledWith(expect.objectContaining({
      bounds: { x: 80, y: 20, width: 400, height: 600 },
    }));
    view.unmount();
    await flush();
    expect(bridge.release).toHaveBeenCalledWith("active");
    expect(bridge.layout).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "active", visible: false }));
  });

  it("clips to an overflow ancestor and suppresses a hidden layer", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.append(inner);
    document.body.append(outer);
    outer.style.overflowX = "hidden";
    outer.style.overflowY = "hidden";
    vi.spyOn(outer, "getBoundingClientRect").mockReturnValue(rect(100, 40, 120, 200));
    expect(measureHostPreviewSlot(inner)).toEqual({ x: 100, y: 40, width: 120, height: 200 });
    outer.hidden = true;
    expect(measureHostPreviewSlot(inner)).toBeNull();
    outer.remove();
  });

  it("keeps the request on mount and releases it exactly once on real unmount", async () => {
    const view = render(<HostFilePreviewSlot requestId="active" onClose={vi.fn()} />);
    await flush();
    expect(bridge.release).not.toHaveBeenCalled();
    expect(bridge.layout).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "active", visible: true,
    }));
    view.unmount();
    await flush();
    expect(bridge.release).toHaveBeenCalledExactlyOnceWith("active");
  });

  it("ignores stale state and close events, exposes retry and closes only its own layer", () => {
    const close = vi.fn();
    const retry = vi.fn();
    render(<HostFilePreviewSlot requestId="active" onClose={close} onRetry={retry} />);
    act(() => { bridge.closed?.("stale"); bridge.state?.({ requestId: "stale", phase: "error", error: "Old" }); });
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { bridge.state?.({ requestId: "active", phase: "error", error: "Denied" }); });
    expect(screen.getByRole("alert")).toHaveTextContent("Denied");
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.retry" }));
    expect(retry).toHaveBeenCalledOnce();
    act(() => { bridge.closed?.("active"); });
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to the generic error for object and oversized errors without crashing", () => {
    render(<HostFilePreviewSlot requestId="active" onClose={vi.fn()} />);
    act(() => { bridge.state?.({ requestId: "active", phase: "error", error: { code: 401 } }); });
    expect(screen.getByRole("alert")).toHaveTextContent("base.messageFile.previewFailed");
    act(() => { bridge.state?.({ requestId: "active", phase: "error", error: "x".repeat(1001) }); });
    expect(screen.getByRole("alert")).toHaveTextContent("base.messageFile.previewFailed");
    act(() => { bridge.state?.({ requestId: "active", phase: "error", error: "still a string" }); });
    expect(screen.getByRole("alert")).toHaveTextContent("still a string");
  });
});
