import { describe, expect, it } from "vitest";
import { SystemContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../../Service/Const";
import {
  isSummaryTipContent,
  SummaryTipContent,
} from "../tip";

describe("SummaryTipContent (WK_TIP 2000 send-side)", () => {
  it("uses the generic system content contract for the sender local echo", () => {
    const content = new SummaryTipContent().setSender(" alice ", " Alice ");

    expect(content).toBeInstanceOf(SystemContent);
    expect(content.contentType).toBe(MessageContentTypeConst.summaryTip);
    expect(content.displayText).toBe("Alice总结了群聊内容");
    expect(content.conversationDigest).toBe("Alice总结了群聊内容");
  });

  it("encodes the locked zh-CN SystemContent placeholder payload", () => {
    const content = new SummaryTipContent().setSender(" alice ", " Alice ");

    expect(content.encodeJSON()).toEqual({
      content: "{0}总结了群聊内容",
      extra: [{ uid: "alice", name: "Alice" }],
    });
    expect(isSummaryTipContent(content)).toBe(true);
  });

  it("inherits receive-side decoding and placeholder substitution", () => {
    const content = new SummaryTipContent();
    content.decodeJSON({
      content: "{0}总结了群聊内容",
      extra: [{ uid: "bob", name: "Bob" }],
    });

    expect(content.displayText).toBe("Bob总结了群聊内容");
    expect(isSummaryTipContent(content)).toBe(true);
  });

  it("does not classify unrelated generic WK_TIP payloads as summary tips", () => {
    const content = new SystemContent();
    content.decodeJSON({
      content: "{0}加入了群聊",
      extra: [{ uid: "bob", name: "Bob" }],
    });

    expect(isSummaryTipContent(content)).toBe(false);
  });
});
