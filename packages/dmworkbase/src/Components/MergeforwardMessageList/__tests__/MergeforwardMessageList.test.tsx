// @vitest-environment jsdom

import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelTypeGroup, MessageContentType } from "wukongimjssdk";
import { I18nContext } from "../../../i18n";
import MergeforwardMessageList from "../index";

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
});
