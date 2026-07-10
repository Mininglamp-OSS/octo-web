import { describe, it, expect, vi } from "vitest";

// SDK MessageContent 基类：仅需可 extend；digest 兜底走 i18n t()。
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
  // 与 message.digest.interactiveCard 对应的静态兜底文案
  t: (key: string) =>
    key === "base.message.digest.interactiveCard" ? "[卡片]" : "",
}));

import {
  InteractiveCardContent,
  cloneInteractiveCardContentForForward,
  isInteractiveCardForwardable,
} from "../InteractiveCardContent";

function decode(raw: unknown): InteractiveCardContent {
  const c = new InteractiveCardContent();
  c.decodeJSON(raw as any);
  return c;
}

describe("InteractiveCardContent.decodeJSON", () => {
  it("正常 payload：逐字段解析 card/plain/card_version/profile", () => {
    const c = decode({
      type: 17,
      card: { type: "AdaptiveCard", body: [] },
      plain: "订单已发货",
      card_version: "1.5",
      profile: "octo/v1",
    });
    expect(c.card).toEqual({ type: "AdaptiveCard", body: [] });
    expect(c.plain).toBe("订单已发货");
    expect(c.cardVersion).toBe("1.5");
    expect(c.profile).toBe("octo/v1");
  });

  it("缺 card：归一为空对象，不抛错", () => {
    const c = decode({ plain: "x", card_version: "1.5", profile: "octo/v1" });
    expect(c.card).toEqual({});
  });

  it("缺 plain：归一为空串", () => {
    const c = decode({ card: {}, card_version: "1.5", profile: "octo/v1" });
    expect(c.plain).toBe("");
  });

  it("字段类型异常：非字符串 plain / 非对象 card 全部安全归一", () => {
    const c = decode({
      card: "not-an-object",
      plain: 123,
      card_version: null,
      profile: ["octo/v1"],
    });
    expect(c.card).toEqual({});
    expect(c.plain).toBe("");
    expect(c.cardVersion).toBe("");
    expect(c.profile).toBe("");
  });

  it("card 为数组：不当作对象，归一为空对象", () => {
    const c = decode({ card: [1, 2, 3], plain: "x" });
    expect(c.card).toEqual({});
  });

  it("容忍未知顶层字段，且不读取 P2 字段行为", () => {
    const c = decode({
      card: {},
      plain: "x",
      profile: "octo/v1",
      card_version: "1.5",
      card_seq: 7,
      transient: true,
      unknownFuture: "ignore-me",
    });
    expect(c.cardSeq).toBe(7);
    expect(c.transient).toBe(true);
  });

  it("转发来源 forwarded_from_uid 逐字段解析并编码保留", () => {
    const c = decode({
      card: {},
      plain: "x",
      profile: "octo/v1",
      card_version: "1.5",
      forwarded_from_uid: "iwh_original",
    });
    expect(c.forwardedFromUID).toBe("iwh_original");
    expect(c.encodeJSON().forwarded_from_uid).toBe("iwh_original");
  });

  it("null / undefined content：安全默认，不抛错", () => {
    expect(() => decode(null)).not.toThrow();
    expect(() => decode(undefined)).not.toThrow();
    const c = decode(null);
    expect(c.card).toEqual({});
    expect(c.plain).toBe("");
  });
});

describe("cloneInteractiveCardContentForForward", () => {
  it("克隆卡片转发副本并写入原始可信发送者，不修改原对象", () => {
    const original = decode({
      card: { type: "AdaptiveCard", body: [] },
      plain: "展示卡",
      profile: "octo/v1",
      card_version: "1.5",
      card_seq: 9,
      transient: true,
    });
    const cloned = cloneInteractiveCardContentForForward(
      original,
      "iwh_original"
    );
    expect(cloned).not.toBe(original);
    expect(cloned.card).toBe(original.card);
    expect(cloned.plain).toBe("展示卡");
    expect(cloned.cardVersion).toBe("1.5");
    expect(cloned.profile).toBe("octo/v1");
    expect(cloned.cardSeq).toBe(9);
    expect(cloned.transient).toBe(true);
    expect(cloned.forwardedFromUID).toBe("iwh_original");
    expect(original.forwardedFromUID).toBe("");
  });
});

describe("isInteractiveCardForwardable", () => {
  it("展示型卡片可转发", () => {
    const c = decode({
      card: {
        type: "AdaptiveCard",
        body: [
          { type: "TextBlock", text: "x" },
          {
            type: "Table",
            columns: [{ width: 1 }],
            rows: [
              {
                type: "TableRow",
                cells: [
                  {
                    type: "TableCell",
                    items: [{ type: "TextBlock", text: "cell" }],
                  },
                ],
              },
            ],
          },
        ],
        actions: [{ type: "Action.CopyToClipboard", title: "复制", text: "x" }],
      },
    });
    expect(isInteractiveCardForwardable(c)).toBe(true);
  });

  it("带 Input 或 Submit 的交互卡不可转发", () => {
    expect(
      isInteractiveCardForwardable(
        decode({
          card: {
            type: "AdaptiveCard",
            body: [{ type: "Input.Text", id: "name" }],
          },
        })
      )
    ).toBe(false);
    expect(
      isInteractiveCardForwardable(
        decode({
          card: {
            type: "AdaptiveCard",
            body: [{ type: "TextBlock", text: "x" }],
            actions: [{ type: "Action.Submit", title: "提交" }],
          },
        })
      )
    ).toBe(false);
  });
});

describe("InteractiveCardContent.contentType", () => {
  it("返回 17", () => {
    expect(decode({ card: {}, plain: "x" }).contentType).toBe(17);
  });
});

describe("InteractiveCardContent.conversationDigest", () => {
  it("plain 非空：优先返回服务端权威 plain", () => {
    expect(decode({ card: {}, plain: "订单已发货" }).conversationDigest).toBe(
      "订单已发货"
    );
  });

  it("plain 空：回退本地化 [卡片]，不本地重算 card", () => {
    expect(decode({ card: { body: [] }, plain: "" }).conversationDigest).toBe(
      "[卡片]"
    );
  });

  it("plain 全空白：视为空，回退占位", () => {
    expect(decode({ card: {}, plain: "   " }).conversationDigest).toBe(
      "[卡片]"
    );
  });

  // 防回归：getMessageDigestText（Conversation/index.tsx）与 ReplyBlock 读取顺序为
  // rawContent.text -> rawContent.conversationDigest。InteractiveCardContent 必须
  // 不暴露 `text` 字段，否则会抢占 digest 优先级、绕过 conversationDigest 的 plain 兜底。
  it("实例不暴露 text 字段（保证 digest 走 conversationDigest）", () => {
    const c = decode({ card: {}, plain: "订单已发货" });
    expect("text" in c).toBe(false);
    expect((c as unknown as { text?: unknown }).text).toBeUndefined();
  });
});
