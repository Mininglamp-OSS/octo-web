// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePreviewInfo } from "../types";

const renderer = vi.hoisted(() => vi.fn());
vi.mock("../../../Utils/download", () => ({ downloadFile: vi.fn() }));
vi.mock("../registry", () => ({
  fileRendererRegistry: {
    getRenderer: renderer,
    canPreview: () => true,
  },
}));
vi.mock("../renderers", () => ({}));
vi.mock("../FilePreviewHeader", () => ({ FilePreviewHeader: () => null }));
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../bridge/html-attachment/useHtmlAttachmentActions", () => ({
  useHtmlAttachmentActions: () => ({ enabled: false }),
}));
vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => <span>Loading</span>,
  Button: ({ theme: _theme, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    theme?: string; icon?: React.ReactNode;
  }) => <button {...props}>{icon}</button>,
}));
vi.mock("@douyinfe/semi-icons", () => ({
  IconClose: () => null,
  IconRefresh: () => null,
}));

import FilePreviewPanel from "../index";
import {
  setWebAttachmentHost,
  tryHostTakeover,
  type WebAttachmentHost,
} from "../../../features/filePreview/attachmentHost";

const file: FilePreviewInfo = {
  url: "https://files.test/preview/report.html",
  downloadUrl: "https://files.test/download/report.html",
  name: "report.html",
  extension: "html",
  sourceChannelId: "group",
  sourceChannelType: 2,
  messageId: "123",
  messageSeq: 4,
  attachmentIndex: 0,
};
let host: WebAttachmentHost;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 40, y: 30, left: 40, top: 30, right: 440, bottom: 630,
    width: 400, height: 600, toJSON() {},
  });
  host = {
    openFilePreview: vi.fn().mockResolvedValue({ status: "accepted" }),
    openFilePreviewInPlace: vi.fn().mockResolvedValue({ status: "accepted" }),
    setFilePreviewLayout: vi.fn().mockResolvedValue(undefined),
    cancelFilePreview: vi.fn().mockResolvedValue(undefined),
  };
  setWebAttachmentHost(host);
  renderer.mockReturnValue({ renderer: () => <div data-testid="web-renderer" /> });
});
afterEach(() => {
  setWebAttachmentHost(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FilePreviewPanel host integration", () => {
  it("mounts the native slot, reports bounds and releases it on unmount", async () => {
    let inlineFile = file;
    await tryHostTakeover(file, (next) => { inlineFile = next; });
    const onClose = vi.fn();
    const view = render(<FilePreviewPanel file={inlineFile} onClose={onClose} />);
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(view.container.querySelector("[data-host-file-preview-slot]")).not.toBeNull();
    expect(renderer).not.toHaveBeenCalled();
    expect(host.setFilePreviewLayout).toHaveBeenLastCalledWith({
      version: 1,
      requestId: inlineFile.hostPreview!.requestId,
      visible: true,
      bounds: { x: 40, y: 30, width: 400, height: 600 },
    });
    expect(screen.queryByTitle("base.filePreview.download")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "base.filePreview.close" }));
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(host.cancelFilePreview).toHaveBeenCalledWith({
      version: 1, requestId: inlineFile.hostPreview!.requestId,
    });
  });

  it("keeps the Web renderer when the host explicitly declines", async () => {
    vi.mocked(host.openFilePreviewInPlace!).mockResolvedValue({ status: "unsupported" });
    expect(await tryHostTakeover(file, () => {})).toBe("fallback");

    render(<FilePreviewPanel file={file} onClose={vi.fn()} />);
    expect(screen.getByTestId("web-renderer")).toBeInTheDocument();
    expect(screen.getByTitle("base.filePreview.download")).toBeInTheDocument();
    expect(renderer).toHaveBeenCalledWith("html");
  });
});
