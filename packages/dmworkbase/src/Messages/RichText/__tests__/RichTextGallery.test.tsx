import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageStatus } from "wukongimjssdk";
import type { MessageWrap } from "../../../Service/Model";
import type ConversationContext from "../../../Components/Conversation/context";
import { ImageGalleryProvider } from "../../../features/conversation-image-gallery/ImageGalleryProvider";
import { collectGalleryImages } from "../../../features/conversation-image-gallery/imageGallery";
import { RichTextCell } from "../index";
import { RichTextContent } from "../RichTextContent";

vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (url: string) => url } },
    emojiService: { emojiRegExp: () => /\[OK\]/, getImage: () => "" },
  },
}));
vi.mock("../../MessageCell", async () => ({
  MessageCell: (await import("react")).Component,
}));
vi.mock("../../../bridge/message/useMessageRow", () => ({
  getMessageRow: () => ({}),
}));
vi.mock("../../../bridge/message/webhookPreview", () => ({
  fleetPreviewClickHandler: () => undefined,
}));
vi.mock("../../../ui/message/MessageRow", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../../ui/message/TextContent", () => ({ default: () => null }));
vi.mock("../../File", () => ({
  formatFileSize: () => "",
  getExtension: () => "",
  getFileIconInfo: () => ({ label: "" }),
}));
vi.mock("../../Image/ImagePreview", () => ({
  ImagePreviewLightbox: ({
    open,
    slides,
    index = 0,
    close,
    showCounter,
  }: {
    open: boolean;
    slides: { src: string; filename?: string }[];
    index?: number;
    close: () => void;
    showCounter?: boolean;
  }) =>
    open ? (
      <div data-testid="preview">
        <span>{showCounter ? "gallery" : "standalone"}</span>
        <span>
          {index + 1}/{slides.length}
        </span>
        <span>{slides[index].filename || slides[index].src}</span>
        <button onClick={close}>close</button>
      </div>
    ) : null,
}));

function example() {
  const content = new RichTextContent();
  content.decodeJSON({
    content: [
      { type: "text", text: "before" },
      { type: "image", url: "https://cdn/same.png", name: "first.png" },
      { type: "image", url: "" },
      { type: "text", text: "between" },
      { type: "image", url: "https://cdn/same.png", name: "second.png" },
    ],
  });
  return {
    clientMsgNo: "rich",
    contentType: 14,
    content,
    status: MessageStatus.Normal,
  } as MessageWrap;
}

function tree(
  message: MessageWrap,
  { selection = false, standalone = false } = {}
) {
  const context = {
    editOn: () => selection,
    isContextMenuOpen: () => false,
  } as ConversationContext;
  const cell = <RichTextCell message={message} context={context} />;
  return standalone ? (
    cell
  ) : (
    <ImageGalleryProvider
      scopeKey="conversation"
      images={collectGalleryImages([message], { resolveUrl: (url) => url })}
    >
      {cell}
    </ImageGalleryProvider>
  );
}

describe("rich-text image preview wiring", () => {
  it("opens the exact repeated image block once, and closes on message revocation", () => {
    const message = example();
    const view = render(tree(message));
    fireEvent.click(screen.getByAltText("second.png"));
    expect(screen.getAllByTestId("preview")).toHaveLength(1);
    expect(screen.getByTestId("preview").textContent).toContain(
      "gallery2/2second.png"
    );
    view.rerender(tree({ ...message, revoke: true } as MessageWrap));
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("does not open either viewer when selecting messages", () => {
    render(tree(example(), { selection: true }));
    fireEvent.click(screen.getByAltText("second.png"));
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("retains standalone preview when no conversation gallery is present", () => {
    render(tree(example(), { standalone: true }));
    fireEvent.click(screen.getByAltText("second.png"));
    expect(screen.getByTestId("preview").textContent).toContain(
      "standalone1/1https://cdn/same.png"
    );
  });
});
