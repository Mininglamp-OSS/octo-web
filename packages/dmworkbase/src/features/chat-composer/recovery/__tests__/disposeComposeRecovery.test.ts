import { describe, expect, it, vi } from "vitest";
import { disposeComposeRecoveryObjectUrls } from "../disposeComposeRecovery";

describe("disposeComposeRecoveryObjectUrls", () => {
  it("releases unique top and editor preview URLs", () => {
    const revoke = vi.fn();

    disposeComposeRecoveryObjectUrls(
      {
        topAttachments: [
          { previewUrl: "blob:top" },
          { previewUrl: "blob:shared" },
        ],
        snapshot: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "attachment", attrs: { previewUrl: "blob:inline" } },
                { type: "attachment", attrs: { previewUrl: "blob:shared" } },
              ],
            },
          ],
        },
      },
      revoke
    );

    expect(revoke.mock.calls.flat()).toEqual([
      "blob:top",
      "blob:shared",
      "blob:inline",
    ]);
  });
});
