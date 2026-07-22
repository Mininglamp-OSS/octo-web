import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIssuePreview: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  UserService: { getUserProfile: mocks.getUserProfile },
  WKApp: { shared: { currentSpaceId: "space-1" } },
}));

vi.mock("../../api/issuePreviewApi", () => ({
  getIssuePreview: mocks.getIssuePreview,
}));

import {
  requestIssuePreview,
  resolvePreviewMemberName,
} from "../useIssuePreview";

const target = {
  workspaceSlug: "1",
  issueIdentifier: "WS-4",
  sourceUrl: "https://im.deepminer.com.cn/fleet/1/issues/WS-4",
};

describe("useIssuePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates concurrent preview loads such as a StrictMode effect replay", async () => {
    let finish: (value: null) => void = () => {};
    mocks.getIssuePreview.mockReturnValue(
      new Promise<null>((resolve) => {
        finish = resolve;
      })
    );
    const first = requestIssuePreview(target, 0);
    const replay = requestIssuePreview(target, 0);

    expect(mocks.getIssuePreview).toHaveBeenCalledOnce();
    finish(null);
    await expect(Promise.all([first, replay])).resolves.toEqual([null, null]);
  });

  it("deduplicates targeted profile lookups by Space and uid", async () => {
    mocks.getUserProfile.mockResolvedValue({ name: "Creator" });

    await expect(
      Promise.all([
        resolvePreviewMemberName("uid-dedup"),
        resolvePreviewMemberName("uid-dedup"),
      ])
    ).resolves.toEqual(["Creator", "Creator"]);
    expect(mocks.getUserProfile).toHaveBeenCalledOnce();
  });
});
