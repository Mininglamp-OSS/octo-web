import { describe, it, expect, vi } from "vitest";
import { downloadAttachmentById } from "../downloadAttachment";

const ID = "019f6039-eebb-72bf-8746-59e58476c47b";

describe("downloadAttachmentById", () => {
  // The core guarantee behind the SVG/unsafe fallback and the non-image card:
  // a download must fetch bytes by id through the authed client, never navigate
  // to the raw auth-only attachment URL (which dead-links under octo-web).
  it("fetches the blob by id and saves it (never touches a raw URL)", async () => {
    const blob = new Blob(["x"], { type: "image/svg+xml" });
    const fetchBlob = vi.fn().mockResolvedValue(blob);
    const saveBlob = vi.fn();

    const ok = await downloadAttachmentById(ID, "diagram.svg", { fetchBlob, saveBlob });

    expect(ok).toBe(true);
    expect(fetchBlob).toHaveBeenCalledExactlyOnceWith(ID);
    expect(saveBlob).toHaveBeenCalledExactlyOnceWith(blob, "diagram.svg");
  });

  it("returns false and does not save when the authed fetch fails", async () => {
    const fetchBlob = vi.fn().mockRejectedValue(new Error("401"));
    const saveBlob = vi.fn();

    const ok = await downloadAttachmentById(ID, "diagram.svg", { fetchBlob, saveBlob });

    expect(ok).toBe(false);
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
