import { describe, it, expect, vi } from "vitest";

vi.mock("wukongimjssdk", () => ({
  MessageContent: class {
    contentObj: any;
    contentType!: number;
    decodeJSON(_: any): void {}
    encodeJSON(): any {
      return {};
    }
    get conversationDigest() {
      return "";
    }
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) =>
    key === "base.message.digest.interactiveCard" ? "[卡片]" : "",
}));

import { InteractiveCardContent } from "../InteractiveCardContent";
import { resolveEffectiveCardContent } from "../resolveContent";

function makeContent(plain: string): InteractiveCardContent {
  const c = new InteractiveCardContent();
  c.decodeJSON({ card: { type: "AdaptiveCard", body: [] }, plain });
  return c;
}

describe("resolveEffectiveCardContent", () => {
  it("未编辑：返回原始 content", () => {
    const original = makeContent("原始卡");
    expect(resolveEffectiveCardContent(original, undefined)).toBe(original);
    expect(resolveEffectiveCardContent(original, { isEdit: false })).toBe(
      original
    );
  });

  it("已编辑且 contentEdit 是 InteractiveCardContent：返回编辑帧", () => {
    const original = makeContent("原始卡");
    const edited = makeContent("编辑后的卡");
    const result = resolveEffectiveCardContent(original, {
      isEdit: true,
      contentEdit: edited,
    });
    expect(result).toBe(edited);
    expect(result.plain).toBe("编辑后的卡");
  });

  it("fail-safe：isEdit 但 contentEdit 不是 InteractiveCardContent → 回退原始", () => {
    const original = makeContent("原始卡");
    // 类型不符的编辑帧（如别的消息类型 / 裸对象）
    expect(
      resolveEffectiveCardContent(original, {
        isEdit: true,
        contentEdit: { plain: "裸对象不可信" },
      })
    ).toBe(original);
    expect(
      resolveEffectiveCardContent(original, {
        isEdit: true,
        contentEdit: undefined,
      })
    ).toBe(original);
  });

  it("isEdit 未置真但携带 contentEdit：仍回退原始（以 isEdit 为准）", () => {
    const original = makeContent("原始卡");
    const edited = makeContent("编辑后的卡");
    expect(
      resolveEffectiveCardContent(original, { contentEdit: edited })
    ).toBe(original);
  });
});
