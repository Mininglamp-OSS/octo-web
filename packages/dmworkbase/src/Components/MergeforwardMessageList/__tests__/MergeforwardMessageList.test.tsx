// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelTypeGroup, MessageContentType } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../../Service/Const";
import { I18nContext } from "../../../i18n";
import MergeforwardMessageList from "../index";
import WKApp from "../../../App";

vi.mock("../../../Messages/Image/ImagePreview", () => ({
  ImagePreviewLightbox: ({ open, slides, index, close, onView }: any) => open ? <div data-testid="image-preview">
    <span data-testid="image-position">{index + 1}/{slides.length}</span>
    <span data-testid="image-filename">{slides[index]?.filename}</span>
    <button onClick={close}>close image</button>
    <button onClick={() => onView(index + 1)}>next image</button>
  </div> : null,
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getImageURL: vi.fn(),
        getFileURL: vi.fn(),
      },
    },
    mittBus: { emit: vi.fn() },
  },
}));

vi.mock("../../../Messages/Mergeforward", () => ({
  default: class MockMergeforwardContent {},
}));

vi.mock("../../WKAvatar", () => ({
  default: () => <div data-testid="avatar" />,
  isBot: () => false,
}));

vi.mock("../../../im-runtime/channelRuntime", () => ({
  fetchImChannelInfo: vi.fn(),
  getImChannelInfo: () => ({ title: "Sender" }),
}));

vi.mock("yet-another-react-lightbox", () => ({
  default: () => null,
}));

vi.mock("yet-another-react-lightbox/plugins/download", () => ({
  default: {},
}));

const i18nValue = {
  locale: "zh-CN",
  t: (key: string) => key,
};

function renderList(
  messageContent: any,
  onMentionClick = vi.fn(),
) {
  const message = {
    contentType: MessageContentType.text,
    content: messageContent,
    fromUID: "sender",
    messageID: "m1",
    timestamp: 1,
  } as any;
  const mergeforwardContent = {
    channelType: ChannelTypeGroup,
    users: [{ uid: "sender", name: "Sender" }],
    msgs: [message],
  };

  const result = render(
    <I18nContext.Provider value={i18nValue as any}>
      <MergeforwardMessageList
        mergeforwardContent={mergeforwardContent}
        onMentionClick={onMentionClick}
      />
    </I18nContext.Provider>,
  );

  return { ...result, onMentionClick };
}

describe("MergeforwardMessageList mention rendering", () => {
  it("opens grouped forwarded images at the clicked attachment and resets on hide or root replacement", () => {
    vi.mocked(WKApp.dataSource.commonDataSource.getImageURL).mockImplementation((url) => url);
    const content: any = {
      channelType: ChannelTypeGroup, users: [], msgs: [
        { contentType: MessageContentType.image, content: { url: "a.png", width: 20, height: 10, name: "a.png" }, messageID: "a", fromUID: "sender", timestamp: 1 },
        { contentType: MessageContentType.image, content: { images: [
          { url: "b.png", width: 20, height: 10, name: "b.png" },
          { url: "c.png", width: 20, height: 10, name: "c.png" },
        ] }, messageID: "group", fromUID: "sender", timestamp: 2 },
      ],
    };
    const tree = (visible = true, source = content) => <I18nContext.Provider value={i18nValue as any}>
      <MergeforwardMessageList mergeforwardContent={source} visible={visible} />
    </I18nContext.Provider>;
    const view = render(tree());
    fireEvent.click(view.container.querySelector('img[src="b.png"]')!);
    expect(screen.getByTestId("image-position").textContent).toBe("2/3");
    fireEvent.click(screen.getByText("next image"));
    expect(screen.getByTestId("image-filename").textContent).toBe("c.png");
    view.rerender(tree(false));
    expect(screen.queryByTestId("image-preview")).toBeNull();
    view.rerender(tree());
    expect(screen.queryByTestId("image-preview")).toBeNull();
    fireEvent.click(view.container.querySelector('img[src="a.png"]')!);
    view.rerender(tree(true, { ...content }));
    expect(screen.queryByTestId("image-preview")).toBeNull();
  });
  it("restores member mention styling from forwarded text mention entities", () => {
    const { container, onMentionClick } = renderList({
      mention: { all: false },
      contentObj: {
        content: "请 @张三 跟进",
        mention: {
          entities: [{ uid: "uid_zhang", offset: 2, length: 3 }],
        },
      },
    });

    const entity = container.querySelector("span.mention-entity");
    expect(entity?.textContent).toBe("@张三");

    fireEvent.click(entity!);
    expect(onMentionClick).toHaveBeenCalledWith("uid_zhang");
  });

  it("renders forwarded broadcast mentions as text-only highlights", () => {
    const { container } = renderList({
      text: "@所有人 请同步",
      mention: { humans: 1 },
    });

    const highlight = container.querySelector("span.mention-highlight");
    expect(highlight?.textContent).toBe("@所有人");
    expect(container.querySelector("span.mention-entity")).toBeNull();
  });

  it("renders forwarded all-AI mentions as text-only highlights", () => {
    const { container } = renderList({
      text: "@所有AI 请总结",
      mention: { ais: 1 },
    });

    const highlight = container.querySelector("span.mention-highlight");
    expect(highlight?.textContent).toBe("@所有AI");
    expect(container.querySelector("span.mention-entity")).toBeNull();
  });

  it("restores legacy member mention styling from forwarded mention uids", () => {
    const { container, onMentionClick } = renderList({
      contentObj: {
        content: "@张三 请跟进",
        mention: { uids: ["uid_zhang"] },
      },
    });

    const entity = container.querySelector("span.mention-entity");
    expect(entity?.textContent).toBe("@张三");

    fireEvent.click(entity!);
    expect(onMentionClick).toHaveBeenCalledWith("uid_zhang");
  });

  it("renders forwarded message rows and external member origin", () => {
    const content: any = {
      channelType: ChannelTypeGroup,
      users: [{ uid: "sender", name: "Sender", is_external: 1, source_space_name: "Remote" }],
      msgs: [
        { contentType: MessageContentType.text, content: { text: "hello" }, fromUID: "sender", messageID: "m1", timestamp: 1 },
        { contentType: MessageContentType.text, content: { text: "again" }, fromUID: "sender", messageID: "m2", timestamp: 2 },
        { contentType: MessageContentType.image, content: { width: 20, height: 10, imgData: "data:image/png" }, fromUID: "other", messageID: "m3", timestamp: 3 },
        { contentType: MessageContentTypeConst.file, content: { extension: "pdf", name: "doc.pdf", size: 2048 }, fromUID: "other", messageID: "m4", timestamp: 4 },
      ],
    };
    const { container } = render(
      <I18nContext.Provider value={i18nValue as any}>
        <MergeforwardMessageList mergeforwardContent={content} />
      </I18nContext.Provider>,
    );
    expect(container.querySelectorAll(".wk-mergeforwardmessagelist-content-msg")).toHaveLength(4);
    expect(container.textContent).toContain("Remote");
    expect(container.textContent).toContain("doc.pdf");
    expect(container.querySelector("img")).toBeTruthy();
  });
});
