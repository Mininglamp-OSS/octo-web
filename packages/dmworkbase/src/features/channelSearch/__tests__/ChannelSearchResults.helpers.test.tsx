// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));
vi.mock("../../../Utils/download", () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
}));
import {
  ChannelSearchEmpty,
  FileResultItem,
  MediaResultGrid,
  MixedResultItem,
} from "../ChannelSearchResults";

describe("ChannelSearchResults leaf renderers", () => {
  it("renders empty states and file result menu actions", () => {
    render(<ChannelSearchEmpty queryStarted={false} emptyHint="empty" />);
    expect(screen.getByText("empty")).toBeTruthy();
    const onMenuOpenChange = vi.fn(),
      onLocate = vi.fn(),
      onPreviewFile = vi.fn();
    const item: any = {
      id: "file-1",
      kind: "file",
      timestamp: 1,
      messageId: "m1",
      file: {
        name: "report.pdf",
        extension: "pdf",
        size: 2048,
        downloadUrl: "https://cdn/report.pdf",
      },
      sender: { uid: "u", name: "Alice", avatarUrl: "avatar" },
    };
    render(
      <FileResultItem
        item={item}
        keyword="rep"
        getSender={() => item.sender}
        menuOpen
        onMenuOpenChange={onMenuOpenChange}
        onLocate={onLocate}
        onPreviewFile={onPreviewFile}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const menuButtons = screen.getAllByRole("button");
    menuButtons.forEach((button) => {
      try {
        fireEvent.click(button);
      } catch {}
    });
    expect(onPreviewFile).toHaveBeenCalled();
    const onPreviewMedia = vi.fn();
    render(
      <MediaResultGrid
        items={[
          {
            id: "media-1",
            kind: "image",
            timestamp: 1700000000,
            media: { url: "https://cdn/image.png", width: 80, height: 60 },
          } as any,
        ]}
        onLocate={onLocate}
        onPreviewMedia={onPreviewMedia}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(onPreviewMedia).toHaveBeenCalled();
  });

  // A chat-tab file message whose body carried a server-side highlighted
  // fragment must render a below-card block with the badge and preserve the
  // server <mark> tags as live elements (rather than raw literal text). Keyword
  // is deliberately different from the marked span so the client-side keyword
  // fallback cannot manufacture the <mark> — the assertion is real evidence
  // that server-mark parsing works, not a coincidence.
  it("renders below-card snippet block when file.contentSnippet is present (chat tab)", () => {
    const sender = { uid: "u1", name: "Hui", avatarUrl: "avatar" };
    const item: any = {
      id: "msg-hit-1",
      kind: "file",
      timestamp: 1700000000,
      messageId: "m1",
      senderUid: "u1",
      sender,
      file: {
        name: "gateway.xlsx",
        extension: "xlsx",
        size: 36864,
        // Marked text ("入口") is not the keyword ("channel") — only server-mark
        // parsing can produce a <mark> here, not the case-insensitive fallback.
        contentSnippet: "channel <mark>入口</mark> 是唯一的",
      },
    };
    const { container } = render(
      <MixedResultItem
        item={item}
        keyword="channel"
        getSender={() => sender}
        onLocate={vi.fn()}
      />
    );
    const snippet = container.querySelector(
      ".wk-channel-search-file-snippet-below"
    );
    expect(snippet).toBeTruthy();
    // Badge label present.
    expect(
      container.querySelector(".wk-channel-search-file-snippet-below-label")
    ).toBeTruthy();
    // Keyword highlighted inside the snippet (from the server marks).
    expect(snippet!.querySelector("mark")?.textContent).toBe("入口");
    // Raw <mark> tags must be consumed by the parser, not surface as literal
    // text — this is what the "server-side <mark> parsing" claim rests on.
    expect(snippet!.textContent).not.toContain("<mark>");
    expect(snippet!.textContent).not.toContain("</mark>");
    // File card still rendered (component untouched, sits above the snippet).
    expect(
      container.querySelector(".wk-channel-search-inline-file-card")
    ).toBeTruthy();
  });

  // Chat-tab file card must consume the server's whole-field nameHighlight so
  // analyzer-mediated matches (English stemming, CJK tokenizing, synonyms) and
  // extension-only matches surface highlighted on the same footing as the File
  // tab. The client-side keyword fallback cannot reproduce those matches, so
  // dropping nameHighlight here silently loses signal.
  it("consumes file.nameHighlight in the chat-tab file name (surfaces server mark)", () => {
    const sender = { uid: "u3", name: "Ma", avatarUrl: "avatar" };
    const item: any = {
      id: "msg-hit-3",
      kind: "file",
      timestamp: 1700000000,
      messageId: "m3",
      senderUid: "u3",
      sender,
      file: {
        name: "quarterly-report.pdf",
        extension: "pdf",
        size: 1024,
        // Server whole-field name_highlight — the keyword "reports" was
        // stemmed to match "report"; a client-side indexOf on the raw name
        // would find nothing.
        nameHighlight: "quarterly-<mark>report</mark>.pdf",
      },
    };
    const { container } = render(
      <MixedResultItem
        item={item}
        keyword="reports"
        getSender={() => sender}
        onLocate={vi.fn()}
      />
    );
    const nameEl = container.querySelector(
      ".wk-channel-search-inline-file-name"
    );
    expect(nameEl).toBeTruthy();
    // Server-provided <mark> is preserved as a real element carrying the
    // matched token — the analyzer-mediated highlight survives to the DOM.
    expect(nameEl!.querySelector("mark")?.textContent).toBe("report");
    // Raw <mark> tags must be consumed by the parser, not literal text.
    expect(nameEl!.textContent).not.toContain("<mark>");
    // With nameHighlight present the extension is preserved (server marks can
    // straddle or fall inside it), matching the File tab display convention.
    expect(nameEl!.textContent).toContain(".pdf");
  });

  it("does NOT render below-card snippet when file.contentSnippet is absent (name-only hit)", () => {
    const sender = { uid: "u2", name: "Chen", avatarUrl: "avatar" };
    const item: any = {
      id: "msg-hit-2",
      kind: "file",
      timestamp: 1700000000,
      messageId: "m2",
      senderUid: "u2",
      sender,
      file: {
        name: "2026Q3-渠道报告.pdf",
        extension: "pdf",
        size: 2 * 1024 * 1024,
        // contentSnippet: undefined  -> name-only hit, no body snippet
      },
    };
    const { container } = render(
      <MixedResultItem
        item={item}
        keyword="渠道"
        getSender={() => sender}
        onLocate={vi.fn()}
      />
    );
    expect(
      container.querySelector(".wk-channel-search-file-snippet-below")
    ).toBeNull();
    // Legacy shape must still render the plain file card.
    expect(
      container.querySelector(".wk-channel-search-inline-file-card")
    ).toBeTruthy();
  });
});
