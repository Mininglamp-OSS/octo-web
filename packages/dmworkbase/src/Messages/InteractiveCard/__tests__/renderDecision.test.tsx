// @vitest-environment jsdom
//
// renderDecision 整条闸口集成测试：trust gate → 协商 → 渲染/兜底 的组合路径。
// 这是 InteractiveCardCell.renderBody 的策略核心（已抽为纯函数便于覆盖）。

import { describe, it, expect, vi, beforeEach } from "vitest";

// channelInfo 查表，驱动 senderTrust 分类。
const channelInfoStore = new Map<string, { orgData?: { robot?: number } }>();

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
  },
  ChannelTypePerson: 1,
  default: {
    shared: () => ({
      channelManager: {
        getChannelInfo: (ch: { channelID: string }) =>
          channelInfoStore.get(ch.channelID),
        fetchChannelInfo: vi.fn(),
      },
    }),
  },
}));

vi.mock("../../../Service/IncomingWebhook", () => ({
  isIncomingWebhookSender: (uid?: string) => !!uid && uid.startsWith("iwh_"),
}));

import { decideCardBody } from "../renderDecision";

const AC = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "AdaptiveCard",
  body,
  ...extra,
});

const validCard = AC([{ type: "TextBlock", text: "hello" }]);

beforeEach(() => {
  channelInfoStore.clear();
});

describe("decideCardBody — sender trust gate（第一道闸）", () => {
  it("普通用户（human）→ plain，绝不渲结构卡", () => {
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    expect(
      decideCardBody({
        fromUID: "u_human",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("pending（channelInfo 未命中）→ plain（fail-closed）", () => {
    expect(
      decideCardBody({
        fromUID: "u_unknown",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("无 fromUID → plain", () => {
    expect(
      decideCardBody({
        fromUID: undefined,
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("webhook（iwh_）可信 → 进入渲染（card）", () => {
    expect(
      decideCardBody({
        fromUID: "iwh_x",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("card");
  });

  it("bot（robot=1）可信 → 进入渲染（card）", () => {
    channelInfoStore.set("u_bot", { orgData: { robot: 1 } });
    expect(
      decideCardBody({
        fromUID: "u_bot",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("card");
  });
});

describe("decideCardBody — 协商（第二道闸，可信 sender 前提）", () => {
  const trusted = { fromUID: "iwh_x" };

  it("不支持 profile → hint（plain + 更新提示）", () => {
    expect(
      decideCardBody({
        ...trusted,
        profile: "octo/v2",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("hint");
  });

  it("card_version 过高 → hint", () => {
    expect(
      decideCardBody({
        ...trusted,
        profile: "octo/v1",
        cardVersion: "2.0",
        card: validCard,
      }).kind
    ).toBe("hint");
  });
});

describe("decideCardBody — 渲染/整卡 fallback（第三道闸）", () => {
  const trusted = { fromUID: "iwh_x", profile: "octo/v1", cardVersion: "1.5" };

  it("合法卡片 → card，且携带渲染节点", () => {
    const d = decideCardBody({ ...trusted, card: validCard });
    expect(d.kind).toBe("card");
    if (d.kind === "card") expect(d.node).toBeTruthy();
  });

  it("未知元素 → plain（整卡 fallback，非 per-element）", () => {
    expect(
      decideCardBody({ ...trusted, card: AC([{ type: "Media" }]) }).kind
    ).toBe("plain");
  });

  it("含 Action.Submit → plain（波 1 禁交互）", () => {
    expect(
      decideCardBody({
        ...trusted,
        card: AC([{ type: "TextBlock", text: "x" }], {
          actions: [{ type: "Action.Submit", title: "提交" }],
        }),
      }).kind
    ).toBe("plain");
  });

  it("结构损坏（非 AdaptiveCard 根）→ plain", () => {
    expect(decideCardBody({ ...trusted, card: { type: "Nope" } }).kind).toBe(
      "plain"
    );
  });
});
