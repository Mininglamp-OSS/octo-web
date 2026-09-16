// @vitest-environment jsdom
import React from "react";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  layout: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  closed: undefined as undefined | ((id: string) => void),
  state: undefined as undefined | ((state: unknown) => void),
  accepted: undefined as undefined | (() => void),
  previewSubscriptions: 0,
}));
vi.mock("@octo/base/src/features/filePreview/attachmentHost", () => ({
  updateHostAttachmentLayout: bridge.layout,
  releaseHostAttachmentPreview: bridge.release,
  subscribeHostAttachmentClosed: (listener: typeof bridge.closed) => {
    bridge.closed = listener; return () => { bridge.closed = undefined; };
  },
  subscribeHostAttachmentState: (listener: typeof bridge.state) => {
    bridge.state = listener; return () => { bridge.state = undefined; };
  },
  subscribeHostAttachmentPreview: (listener: typeof bridge.accepted) => {
    bridge.previewSubscriptions += 1;
    bridge.accepted = listener; return () => { bridge.accepted = undefined; };
  },
}));
vi.mock("@octo/base/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => <span>Loading</span>,
  Button: ({ theme, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    theme?: string; icon?: React.ReactNode;
  }) => <button {...props}>{icon}</button>,
}));
vi.mock("@douyinfe/semi-icons", () => ({ IconClose: () => <span />, IconRefresh: () => <span /> }));

import { createRoot, type Root } from "react-dom/client";
import { HostFilePreviewSlot } from "@octo/base/src/features/filePreview/HostFilePreviewSlot";

const rect = (x = 50, y = 20, width = 320, height = 600) =>
  ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} });

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  bridge.previewSubscriptions = 0;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect());
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  if (root) {
    act(() => { root?.unmount(); });
    root = undefined;
  }
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async () => { await act(async () => { vi.advanceTimersByTime(500); }); };
const mount = (node: React.ReactNode) => {
  root = createRoot(container);
  act(() => { root!.render(node); });
};

describe("host file preview slot (React 18 createRoot)", () => {
  it("replays effects under StrictMode without releasing, then releases exactly once on real unmount", async () => {
    mount(<React.StrictMode>
      <HostFilePreviewSlot requestId="active" onClose={vi.fn()} />
    </React.StrictMode>);
    await flush();

    // StrictMode + createRoot re-runs effects: subscriptions set up twice
    expect(bridge.previewSubscriptions).toBe(2);
    expect(bridge.release).not.toHaveBeenCalled();
    expect(bridge.layout).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "active", visible: true,
    }));

    act(() => { root!.unmount(); });
    root = undefined;
    await flush();
    expect(bridge.release).toHaveBeenCalledExactlyOnceWith("active");
  });
});
