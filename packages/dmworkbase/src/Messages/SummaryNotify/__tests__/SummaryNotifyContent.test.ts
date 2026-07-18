import { beforeEach, describe, expect, it, vi } from "vitest";

const channelManager = vi.hoisted(() => ({
  getChannelInfo: vi.fn(),
}));

vi.mock("wukongimjssdk", () => {
  const ChannelTypePerson = 1;
  const ChannelTypeGroup = 2;
  class Channel {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  }
  class MessageContent {
    contentObj: any = {};
    decodeJSON(_content: any): void {}
    encodeJSON(): any {
      return {};
    }
  }
  const sdk = { shared: () => ({ channelManager }) };
  return {
    default: sdk,
    WKSDK: sdk,
    Channel,
    ChannelTypePerson,
    ChannelTypeGroup,
    MessageContent,
  };
});

vi.mock("../../../App", () => ({
  default: { loginInfo: { uid: "me" } },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string, opts?: any) => {
    if (key === "base.message.summaryNotify.you") return "你";
    if (key === "base.message.summaryNotify.text") {
      return `${opts?.values?.name}总结了群聊内容`;
    }
    return key;
  },
}));

import { MessageContentTypeConst } from "../../../Service/Const";
import { SummaryNotifyContent } from "../index";

describe("SummaryNotifyContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelManager.getChannelInfo.mockReturnValue(undefined);
  });

  it("reports contentType 21 (summaryNotify)", () => {
    const content = new SummaryNotifyContent();
    expect(content.contentType).toBe(21);
    expect(content.contentType).toBe(MessageContentTypeConst.summaryNotify);
  });

  it("round-trips fromUID/fromName through encodeJSON/decodeJSON", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    const encoded = content.encodeJSON();
    expect(encoded).toEqual({ from_uid: "alice", from_name: "Alice" });

    const decoded = new SummaryNotifyContent();
    decoded.decodeJSON(encoded);
    expect(decoded.fromUID).toBe("alice");
    expect(decoded.fromName).toBe("Alice");
  });

  it("shows «你» when the sender is the current user", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "me";
    content.fromName = "Me";
    expect(content.tip).toBe("你总结了群聊内容");
    expect(content.conversationDigest).toBe("你总结了群聊内容");
  });

  it("falls back to fromName when the sender is someone else", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.tip).toBe("Alice总结了群聊内容");
  });

  it("prefers channel displayName over fromName when available", () => {
    channelManager.getChannelInfo.mockReturnValue({
      orgData: { displayName: "Alice (Sales)" },
    });
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.tip).toBe("Alice (Sales)总结了群聊内容");
  });

  it("falls back to fromName when channelInfo exists but displayName is missing", () => {
    // channelInfo 命中但 orgData.displayName 缺失时，不能渲染成 undefined。
    channelManager.getChannelInfo.mockReturnValue({ orgData: {} });
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.tip).toBe("Alice总结了群聊内容");
  });
});
