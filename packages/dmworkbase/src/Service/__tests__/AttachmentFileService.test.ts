import { beforeEach, describe, expect, it, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
vi.mock("../APIClient", () => ({ default: { shared: { get } } }));
import AttachmentFileService from "../AttachmentFileService";

describe("attachment download contract", () => {
  beforeEach(() => {
    get.mockReset();
  });
  it("passes the original Unicode filename, object reference, captured space and cancellation", async () => {
    get.mockResolvedValue({
      url: "https://store.test/chat/id?signature=1",
      filename: "报告 Q3.html",
    });
    const signal = new AbortController().signal;
    await expect(
      AttachmentFileService.getDownloadLink(
        "chat/2/id",
        "报告 Q3.html",
        "space-a",
        signal
      )
    ).resolves.toBe("https://store.test/chat/id?signature=1");
    expect(get).toHaveBeenCalledWith("file/download/url", {
      param: {
        path: "chat/2/id",
        filename: "报告 Q3.html",
        disposition: "attachment",
      },
      headers: { "X-Space-Id": "space-a" },
      signal,
      suppressAuthExpiredLogout: true,
    });
  });
  it.each([
    {},
    { url: "" },
    { url: "javascript:alert(1)" },
    { url: "/file/id" },
  ])(
    "rejects unusable responses instead of returning the original path",
    async (result) => {
      get.mockResolvedValue(result);
      await expect(
        AttachmentFileService.getDownloadLink("chat/id", "a.html", "a")
      ).rejects.toThrow();
    }
  );
  it("preserves signing failures for the caller", async () => {
    const failure = { status: 401 };
    get.mockRejectedValue(failure);
    await expect(
      AttachmentFileService.getDownloadLink("chat/id", "a.html", "a")
    ).rejects.toBe(failure);
  });
});
