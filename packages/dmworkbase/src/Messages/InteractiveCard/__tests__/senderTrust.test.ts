import { describe, it, expect, vi, beforeEach } from "vitest";

// 可变的 channelInfo 查表，模拟缓存命中/未命中与 robot 标记。
const channelInfoStore = new Map<string, { orgData?: { robot?: number } }>();
const fetchChannelInfo = vi.fn();

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
        fetchChannelInfo,
      },
    }),
  },
}));

// isIncomingWebhookSender：iwh_ 前缀（与真实实现一致）。
vi.mock("../../../Service/IncomingWebhook", () => ({
  isIncomingWebhookSender: (uid?: string) => !!uid && uid.startsWith("iwh_"),
}));

import {
  classifyCardSender,
  isTrustedCardSender,
  fetchSenderChannelInfo,
} from "../senderTrust";

beforeEach(() => {
  channelInfoStore.clear();
  fetchChannelInfo.mockClear();
});

describe("classifyCardSender", () => {
  it("webhook：iwh_ 前缀同步信任，不查 channelInfo", () => {
    expect(classifyCardSender("iwh_abc123")).toBe("webhook");
  });

  it("bot：channelInfo.orgData.robot===1", () => {
    channelInfoStore.set("u_bot", { orgData: { robot: 1 } });
    expect(classifyCardSender("u_bot")).toBe("bot");
  });

  it("human：channelInfo 存在但 robot!==1", () => {
    channelInfoStore.set("u_human", { orgData: { robot: 0 } });
    expect(classifyCardSender("u_human")).toBe("human");
  });

  it("human：channelInfo 存在但无 orgData", () => {
    channelInfoStore.set("u_plain", {});
    expect(classifyCardSender("u_plain")).toBe("human");
  });

  it("pending：非 webhook 且 channelInfo 未命中（fail-closed）", () => {
    expect(classifyCardSender("u_unknown")).toBe("pending");
  });

  it("无 fromUID：判 human，不渲结构卡", () => {
    expect(classifyCardSender(undefined)).toBe("human");
    expect(classifyCardSender("")).toBe("human");
  });
});

describe("isTrustedCardSender", () => {
  it("仅 webhook / bot 可信", () => {
    expect(isTrustedCardSender("webhook")).toBe(true);
    expect(isTrustedCardSender("bot")).toBe(true);
  });

  it("human / pending 不可信（fail-closed）", () => {
    expect(isTrustedCardSender("human")).toBe(false);
    expect(isTrustedCardSender("pending")).toBe(false);
  });
});

describe("fetchSenderChannelInfo", () => {
  it("触发 SDK fetchChannelInfo 拉取 Person channelInfo", () => {
    fetchSenderChannelInfo("u_unknown");
    expect(fetchChannelInfo).toHaveBeenCalledTimes(1);
    const arg = fetchChannelInfo.mock.calls[0][0];
    expect(arg.channelID).toBe("u_unknown");
    expect(arg.channelType).toBe(1);
  });
});

describe("late-arrival 自愈：pending → channelInfo 到达后重新分类", () => {
  it("先 pending，缓存写入 robot=1 后判 bot", () => {
    expect(classifyCardSender("u_late")).toBe("pending");
    channelInfoStore.set("u_late", { orgData: { robot: 1 } });
    expect(classifyCardSender("u_late")).toBe("bot");
  });

  it("先 pending，缓存写入非 bot 后判 human（永不渲结构卡）", () => {
    expect(classifyCardSender("u_late2")).toBe("pending");
    channelInfoStore.set("u_late2", { orgData: { robot: 0 } });
    expect(classifyCardSender("u_late2")).toBe("human");
  });
});
