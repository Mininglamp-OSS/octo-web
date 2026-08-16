import { describe, expect, it } from "vitest";
import {
  buildDocumentTitle,
  formatUnreadConversationPrefix,
} from "./titleRules";

describe("document title rules", () => {
  it.each([
    [0, ""],
    [1, "(1) "],
    [99, "(99) "],
    [100, "(99+) "],
    [999, "(99+) "],
  ])("formats %s unread conversations", (count, expected) => {
    expect(formatUnreadConversationPrefix(count)).toBe(expected);
  });

  it("formats a direct or group conversation", () => {
    expect(
      buildDocumentTitle({
        unreadConversationCount: 3,
        context: { primaryTitle: "产品设计讨论" },
      })
    ).toBe("(3) 产品设计讨论 - Octo");
  });

  it("formats a full-screen Thread from parent to child", () => {
    expect(
      buildDocumentTitle({
        unreadConversationCount: 1,
        context: { parentTitle: "北京产研团队", primaryTitle: "产品设计讨论" },
      })
    ).toBe("(1) 北京产研团队 > 产品设计讨论 - Octo");
  });

  it("formats named content with its localized module title", () => {
    expect(
      buildDocumentTitle({
        unreadConversationCount: 0,
        context: { primaryTitle: "年度经营计划", moduleTitle: "文档" },
      })
    ).toBe("年度经营计划 - 文档 - Octo");
  });

  it("falls back to the localized active module title", () => {
    expect(
      buildDocumentTitle({
        unreadConversationCount: 0,
        fallbackTitle: "通讯录",
      })
    ).toBe("通讯录 - Octo");
  });
});
