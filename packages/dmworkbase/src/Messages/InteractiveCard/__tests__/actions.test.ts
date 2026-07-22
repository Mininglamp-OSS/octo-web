import { beforeEach, describe, expect, it, vi } from "vitest";

const { openSummaryDetailMock, openDocPreviewMock, hasDocPaneMock, wkAppMock } = vi.hoisted(() => {
  const openSummaryDetailMock = vi.fn();
  const openDocPreviewMock = vi.fn();
  const hasDocPaneMock = vi.fn(() => true);
  return {
    openSummaryDetailMock,
    openDocPreviewMock,
    hasDocPaneMock,
    wkAppMock: {
      openSummaryDetail: openSummaryDetailMock as ((taskId: number | string, spaceId?: string) => void) | undefined,
      openDocPreview: openDocPreviewMock as ((docId: string, space?: string) => void) | undefined,
      endpoints: {
        hasChatDocPreviewPane: hasDocPaneMock as () => boolean,
      },
    },
  };
});

vi.mock("../../../App", () => ({
  default: wkAppMock,
}));

import { openUrl } from "../renderer/actions";

describe("openUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    openSummaryDetailMock.mockReset();
    openDocPreviewMock.mockReset();
    hasDocPaneMock.mockReset();
    hasDocPaneMock.mockReturnValue(true);
    wkAppMock.openSummaryDetail = openSummaryDetailMock;
    wkAppMock.openDocPreview = openDocPreviewMock;
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("routes /s/<taskNo> summary links internally", () => {
    openUrl("https://web.example.com/s/ST202607145kstyh08?sp=space-1");

    expect(openSummaryDetailMock).toHaveBeenCalledTimes(1);
    expect(openSummaryDetailMock).toHaveBeenCalledWith("ST202607145kstyh08", "space-1");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("routes /s/<taskNo> without sp with undefined space", () => {
    openUrl("https://web.example.com/s/ST202607145kstyh08");

    expect(openSummaryDetailMock).toHaveBeenCalledTimes(1);
    expect(openSummaryDetailMock).toHaveBeenCalledWith("ST202607145kstyh08", undefined);
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens external https links in a new tab", () => {
    openUrl("https://web.example.com/docs/ST202607145kstyh08");

    expect(openSummaryDetailMock).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://web.example.com/docs/ST202607145kstyh08",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("ignores unsafe urls", () => {
    openUrl("javascript:alert(1)");

    expect(openSummaryDetailMock).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("routes a same-origin /d/<docId>?sp= document link to the in-chat sidebar", () => {
    openUrl(`${window.location.origin}/d/doc123?sp=space-1`);

    expect(openDocPreviewMock).toHaveBeenCalledWith("doc123", "space-1");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens a document link in a new tab when the sidebar host is unavailable", () => {
    wkAppMock.openDocPreview = undefined;

    openUrl(`${window.location.origin}/d/doc123?sp=space-1`);

    expect(openDocPreviewMock).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}/d/doc123?sp=space-1`,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("opens a document link in a new tab when the docs pane endpoint is not registered", () => {
    hasDocPaneMock.mockReturnValue(false);

    openUrl(`${window.location.origin}/d/doc123?sp=space-1`);

    expect(openDocPreviewMock).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      `${window.location.origin}/d/doc123?sp=space-1`,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("falls back to window.open when summary routing is unavailable", () => {
    wkAppMock.openSummaryDetail = undefined;

    openUrl("https://web.example.com/s/ST202607145kstyh08?sp=space-1");

    expect(openSummaryDetailMock).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://web.example.com/s/ST202607145kstyh08?sp=space-1",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
