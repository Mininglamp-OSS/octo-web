import React from "react";
import { describe, expect, it, vi } from "vitest";
import { chatPendingComposeRenderRegistry } from "../chatPendingComposeRenderRegistry";

function item(attachments: Array<{ id: string; name: string; type: string }>) {
  return {
    id: "attempt-1",
    capturedAt: 1,
    previewText: "caption",
    draftText: "caption",
    attachments,
    expectedParts: 1,
    enqueuedParts: 0,
  };
}

describe("chatPendingComposeRenderRegistry", () => {
  it("uses the registered attachment renderer for pending files", () => {
    const renderAttachment = vi.fn((attachment: { id: string }) =>
      React.createElement("span", { key: attachment.id }),
    );

    const rendered = chatPendingComposeRenderRegistry.render(
      item([{ id: "file-1", name: "report.pdf", type: "application/pdf" }]),
      { sendingLabel: "sending", renderAttachment },
    );

    expect(rendered).not.toBeNull();
    expect(renderAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-1" }),
    );
  });

  it("keeps the fallback renderer for text-only attempts", () => {
    const renderAttachment = vi.fn(() => null);

    expect(
      chatPendingComposeRenderRegistry.render(item([]), {
        sendingLabel: "sending",
        renderAttachment,
      }),
    ).not.toBeNull();
    expect(renderAttachment).not.toHaveBeenCalled();
  });
});
