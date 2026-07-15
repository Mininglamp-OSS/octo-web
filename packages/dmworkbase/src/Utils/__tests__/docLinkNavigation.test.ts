import { beforeEach, describe, expect, it, vi } from "vitest";

const { openDocPreviewMock, wkAppMock } = vi.hoisted(() => {
  const openDocPreviewMock = vi.fn();
  return {
    openDocPreviewMock,
    wkAppMock: {
      openDocPreview: openDocPreviewMock as
        | ((docId: string, space?: string) => void)
        | undefined,
    },
  };
});

vi.mock("../../App", () => ({
  default: wkAppMock,
}));

import { tryOpenDocLinkInSidebar } from "../docLinkNavigation";

const ORIGIN = window.location.origin;

describe("tryOpenDocLinkInSidebar", () => {
  beforeEach(() => {
    openDocPreviewMock.mockReset();
    wkAppMock.openDocPreview = openDocPreviewMock;
  });

  it("opens a same-origin doc link inline and reports handled", () => {
    const handled = tryOpenDocLinkInSidebar(`${ORIGIN}/d/doc123?sp=space-1`);
    expect(handled).toBe(true);
    expect(openDocPreviewMock).toHaveBeenCalledWith("doc123", "space-1");
  });

  it("passes undefined space when the link omits ?sp", () => {
    expect(tryOpenDocLinkInSidebar(`${ORIGIN}/d/doc123`)).toBe(true);
    expect(openDocPreviewMock).toHaveBeenCalledWith("doc123", undefined);
  });

  it("does not intercept a non-document link", () => {
    expect(tryOpenDocLinkInSidebar(`${ORIGIN}/s/ST123`)).toBe(false);
    expect(openDocPreviewMock).not.toHaveBeenCalled();
  });

  it("does not intercept a cross-origin /d/ link", () => {
    expect(tryOpenDocLinkInSidebar("https://evil.example.com/d/doc123")).toBe(false);
    expect(openDocPreviewMock).not.toHaveBeenCalled();
  });

  it("falls back (returns false) when no sidebar host is mounted", () => {
    wkAppMock.openDocPreview = undefined;
    expect(tryOpenDocLinkInSidebar(`${ORIGIN}/d/doc123?sp=space-1`)).toBe(false);
  });
});
