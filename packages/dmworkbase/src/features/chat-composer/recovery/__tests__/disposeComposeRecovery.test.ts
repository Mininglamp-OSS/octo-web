import { describe, expect, it, vi } from "vitest";
import { disposeComposeRecoveryObjectUrls } from "../disposeComposeRecovery";

describe("disposeComposeRecoveryObjectUrls", () => {
  it("releases unique top and editor preview URLs", () => {
    const revoke = vi.fn();

    disposeComposeRecoveryObjectUrls(
      {
        editorObjectUrls: ["blob:inline", "blob:shared"],
        topAttachments: [
          { previewUrl: "blob:top" },
          { previewUrl: "blob:shared" },
        ],
      },
      revoke
    );

    expect(revoke.mock.calls.flat()).toEqual([
      "blob:top",
      "blob:shared",
      "blob:inline",
    ]);
  });

  it("does not inspect snapshot URLs that the recovery does not own", () => {
    const revoke = vi.fn();

    disposeComposeRecoveryObjectUrls(
      {
        editorObjectUrls: ["blob:unsent"],
        topAttachments: [],
        snapshot: { attrs: { previewUrl: "blob:already-sent" } },
      } as never,
      revoke,
    );

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:unsent");
  });
});
