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

describe("decideCardBody — 交互授权分层（interactive：仅 bot 卡可提交）", () => {
  it("bot 卡 → interactive=true", () => {
    channelInfoStore.set("u_bot", { orgData: { robot: 1 } });
    const d = decideCardBody({
      fromUID: "u_bot",
      profile: "octo/v2",
      cardVersion: "1.5",
      card: validCard,
    });
    expect(d.kind).toBe("card");
    if (d.kind === "card") expect(d.interactive).toBe(true);
  });

  it("webhook 卡 → interactive=false（展示-only）", () => {
    const d = decideCardBody({
      fromUID: "iwh_x",
      profile: "octo/v2",
      cardVersion: "1.5",
      card: validCard,
    });
    expect(d.kind).toBe("card");
    if (d.kind === "card") expect(d.interactive).toBe(false);
  });

  it("普通用户逐条转发可信 webhook 卡 → plain（不采信 payload 的 forwarded_from_uid）", () => {
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    // 转发场景：直连发送者是普通用户，payload 携带原可信来源 iwh_original。
    // 由于 forwarded_from_uid 不受服务端归属背书，接收端必须 fail-closed 渲 plain，
    // 避免任意用户伪造 forwarded_from_uid:"iwh_x" 的裸 type-17 包冒充结构化卡。
    expect(
      decideCardBody({
        fromUID: "u_human",
        forwardedFromUID: "iwh_original",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("普通用户伪造 forwarded_from_uid=iwh_* 裸包 → plain（信任边界不由 payload 派生）", () => {
    // 攻击复现：普通用户从直连 socket 写入 type-17 包，携带 forwarded_from_uid:"iwh_x"。
    // fromUID 是服务端权威信封（human），fail-closed；不再回落 payload 字段。
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    expect(
      decideCardBody({
        fromUID: "u_human",
        forwardedFromUID: "iwh_forged_by_attacker",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("普通用户伪造 forwarded_from_uid=某真实 bot UID → plain（同上，任何 payload 声明都不采信）", () => {
    // 冒充「已知 bot」的变体：即使 UID 恰好在本地缓存里 orgData.robot===1，
    // 也不通过 payload 字段回落信任，杜绝显示级冒充。
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    channelInfoStore.set("u_bot_real", { orgData: { robot: 1 } });
    expect(
      decideCardBody({
        fromUID: "u_human",
        forwardedFromUID: "u_bot_real",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });

  it("普通用户伪造无可信来源卡 → plain", () => {
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    channelInfoStore.set("u_other_human", { orgData: { robot: 0 } });
    expect(
      decideCardBody({
        fromUID: "u_human",
        forwardedFromUID: "u_other_human",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("plain");
  });
});

describe("decideCardBody — 协商（第二道闸，可信 sender 前提）", () => {
  const trusted = { fromUID: "iwh_x" };

  it("更高/未知 profile（octo/v3）→ hint（plain + 更新提示）", () => {
    expect(
      decideCardBody({
        ...trusted,
        profile: "octo/v3",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("hint");
  });

  it("octo/v2 现已支持 → 进入渲染（card）", () => {
    expect(
      decideCardBody({
        ...trusted,
        profile: "octo/v2",
        cardVersion: "1.5",
        card: validCard,
      }).kind
    ).toBe("card");
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

describe("decideCardBody — card_version 1.6（对齐 SDK 上限，版本放宽但元素门禁不放松）", () => {
  const trusted = { fromUID: "iwh_x", profile: "octo/v1" as const };

  it("1.6 + octo 白名单元素 → card（版本协商放行，将来服务端升 1.6 无需发版）", () => {
    expect(
      decideCardBody({ ...trusted, cardVersion: "1.6", card: validCard }).kind
    ).toBe("card");
  });

  it("1.6 + 非白名单元素 → plain（元素门禁仍 fail-closed，1.6-only 元素不放行）", () => {
    expect(
      decideCardBody({
        ...trusted,
        cardVersion: "1.6",
        card: AC([{ type: "Carousel" }]),
      }).kind
    ).toBe("plain");
  });
});

describe("decideCardBody — octo/v2 交互元素（allowInteractive）", () => {
  const trustedV2 = {
    fromUID: "iwh_x",
    profile: "octo/v2",
    cardVersion: "1.5",
  };

  it("v2 卡含 Input.* + Action.Submit → card（展示态渲染，不 fallback）", () => {
    const d = decideCardBody({
      ...trustedV2,
      card: AC([{ type: "Input.Text", id: "name" }], {
        actions: [{ type: "Action.Submit", id: "ok", title: "提交" }],
      }),
    });
    expect(d.kind).toBe("card");
  });

  it("同一元素在 v1 profile 下 → plain（v1 不含 Input.*/Submit 白名单）", () => {
    expect(
      decideCardBody({
        fromUID: "iwh_x",
        profile: "octo/v1",
        cardVersion: "1.5",
        card: AC([{ type: "Input.Text", id: "name" }]),
      }).kind
    ).toBe("plain");
  });

  it("v2 卡含 Action.Execute → plain（永不支持，整卡 fallback）", () => {
    expect(
      decideCardBody({
        ...trustedV2,
        card: AC([{ type: "TextBlock", text: "x" }], {
          actions: [{ type: "Action.Execute", id: "e", title: "run" }],
        }),
      }).kind
    ).toBe("plain");
  });

  it("v2 卡帧内重复 id → plain（D1 整卡 fallback）", () => {
    expect(
      decideCardBody({
        ...trustedV2,
        card: AC([
          { type: "Input.Text", id: "dup" },
          { type: "Input.Toggle", id: "dup" },
        ]),
      }).kind
    ).toBe("plain");
  });
});

describe("decideCardBody — 渲染/整卡 fallback（第三道闸）", () => {
  const trusted = { fromUID: "iwh_x", profile: "octo/v1", cardVersion: "1.5" };

  it("合法卡片 → card，且携带已校验的 card + allowInteractive", () => {
    const d = decideCardBody({ ...trusted, card: validCard });
    expect(d.kind).toBe("card");
    if (d.kind === "card") {
      expect(d.card).toBeTruthy();
      expect(d.allowInteractive).toBe(false); // octo/v1
    }
  });

  it("服务端 manifest 展示元素 RichTextBlock → card", () => {
    expect(
      decideCardBody({
        ...trusted,
        card: AC([
          {
            type: "RichTextBlock",
            inlines: [{ type: "TextRun", text: "读取文件" }],
          },
        ]),
      }).kind
    ).toBe("card");
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
