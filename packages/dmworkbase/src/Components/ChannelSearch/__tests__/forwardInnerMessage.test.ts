import { describe, expect, it } from "vitest";
import {
  formatForwardInnerMessage,
  getForwardInnerMessageHiddenCount,
} from "../forwardInnerMessage";

const translations: Record<string, string> = {
  "base.channelSearch.forward.placeholder.file": "[文件]",
  "base.channelSearch.forward.placeholder.image": "[图片]",
  "base.channelSearch.forward.placeholder.message": "[消息]",
  "base.channelSearch.forward.placeholder.video": "[视频]",
};

const t = (key: string) => translations[key] || key;

const getSender = (uid: string) => ({
  uid,
  name: uid === "u-bob" ? "Bob" : uid,
});

describe("forward inner message formatting", () => {
  it("prepends sender name for backend body-only search text", () => {
    expect(
      formatForwardInnerMessage(
        {
          messageId: "inner-1",
          type: 1,
          text: "命中的<mark>聊天</mark>记录正文",
          senderName: "Alice",
        },
        getSender,
        t
      )
    ).toBe("Alice：命中的<mark>聊天</mark>记录正文");
  });

  it("does not duplicate sender labels when text is already prefixed", () => {
    expect(
      formatForwardInnerMessage(
        {
          messageId: "inner-1",
          type: 1,
          text: "Alice：命中的<mark>聊天</mark>记录正文",
          senderName: "Alice",
        },
        getSender,
        t
      )
    ).toBe("Alice：命中的<mark>聊天</mark>记录正文");

    expect(
      formatForwardInnerMessage(
        {
          messageId: "inner-2",
          type: 1,
          text: "Alice: hit text",
          senderName: "Alice",
        },
        getSender,
        t
      )
    ).toBe("Alice: hit text");
  });

  it("uses sender lookup and placeholder fallback without leaking raw ids", () => {
    expect(
      formatForwardInnerMessage(
        {
          messageId: "inner-1",
          type: 8,
          text: "",
          senderUid: "u-bob",
        },
        getSender,
        t
      )
    ).toBe("Bob：[文件]");

    expect(
      formatForwardInnerMessage(
        {
          messageId: "inner-2",
          type: 8,
          text: "",
          senderUid: "raw-uid",
        },
        getSender,
        t
      )
    ).toBe("[文件]");
  });

  it("reports hidden inner messages from array length or child count", () => {
    expect(getForwardInnerMessageHiddenCount(10, 4)).toBe(6);
    expect(getForwardInnerMessageHiddenCount(4, 4, 10)).toBe(6);
    expect(getForwardInnerMessageHiddenCount(4, 4, 4)).toBe(0);
  });
});
