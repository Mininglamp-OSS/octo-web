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
    if (key === "base.message.summaryNotify.unknown") return "某用户";
    if (key === "base.message.summaryNotify.text") {
      return `${opts?.values?.name}总结了群聊内容`;
    }
    return key;
  },
}));

import { MessageContentTypeConst } from "../../../Service/Const";
import { SummaryNotifyCell, SummaryNotifyContent } from "../index";

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

  it("normalizes malformed or blank identity fields while decoding", () => {
    const decoded = new SummaryNotifyContent();
    decoded.decodeJSON({ from_uid: 42, from_name: "  " });
    expect(decoded.fromUID).toBe("");
    expect(decoded.fromName).toBe("");
  });

  it("shows «你» when the sender is the current user", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "me";
    content.fromName = "Me";
    expect(content.tipForSender("me")).toBe("你总结了群聊内容");
    expect(content.conversationDigest).toBe("某用户总结了群聊内容");
  });

  it("does not trust payload fromName when the remote sender profile is not cached", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "张总";
    expect(content.tipForSender("alice")).toBe("某用户总结了群聊内容");
  });

  it("prefers channel displayName over fromName when available", () => {
    channelManager.getChannelInfo.mockReturnValue({
      orgData: { displayName: "Alice (Sales)" },
    });
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.tipForSender("alice")).toBe("Alice (Sales)总结了群聊内容");
  });

  it("uses the neutral fallback when channelInfo exists but displayName is missing", () => {
    channelManager.getChannelInfo.mockReturnValue({ orgData: {} });
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.tipForSender("alice")).toBe("某用户总结了群聊内容");
  });

  it("uses a neutral fallback when both cached and embedded names are blank", () => {
    channelManager.getChannelInfo.mockReturnValue({ orgData: { displayName: "  " } });
    const content = new SummaryNotifyContent();
    content.fromUID = "unknown";
    content.fromName = "";
    expect(content.tipForSender("unknown")).toBe("某用户总结了群聊内容");
  });

  it("renders the authenticated envelope sender instead of spoofable payload from_uid", () => {
    channelManager.getChannelInfo.mockImplementation((channel: any) => ({
      orgData: { displayName: channel.channelID === "alice" ? "Alice" : "Mallory" },
    }));
    const content = new SummaryNotifyContent();
    content.fromUID = "mallory";
    content.fromName = "Mallory";
    const cell = new SummaryNotifyCell({
      message: { fromUID: "alice", content },
    } as any);

    const element = cell.render() as any;
    expect(element.props.children).toBe("Alice总结了群聊内容");
    expect(channelManager.getChannelInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ channelID: "alice" }),
    );
  });

  it("keeps digest sender-neutral even when payload claims another uid", () => {
    channelManager.getChannelInfo.mockReturnValue({
      orgData: { displayName: "Victim" },
    });
    const content = new SummaryNotifyContent();
    content.fromUID = "victim";
    content.fromName = "Victim";
    expect(content.conversationDigest).toBe("某用户总结了群聊内容");
    expect(channelManager.getChannelInfo).not.toHaveBeenCalled();
  });
});
