import { beforeEach, describe, expect, it, vi } from "vitest";

const getChannelInfo = vi.hoisted(() => vi.fn());
const fetchChannelInfo = vi.hoisted(() => vi.fn());

vi.mock("wukongimjssdk", () => {
  class Channel {
    constructor(public channelID: string, public channelType: number) {}
  }
  class MessageContent {}
  return {
    Channel,
    ChannelTypePerson: 1,
    MessageContent,
    WKSDK: { shared: () => ({}) },
  };
});

vi.mock("../../../App", () => ({
  default: { loginInfo: { uid: "me" } },
}));

vi.mock("../../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: getChannelInfo,
  fetchImChannelInfo: fetchChannelInfo,
}));

vi.mock("../../../i18n", () => ({
  t: (key: string, options?: any) =>
    ({
      "base.message.summaryNotify.you": "你",
      "base.message.summaryNotify.unknown": "某用户",
      "base.message.summaryNotify.action": "总结了群聊内容",
      "base.message.summaryNotify.text": `${options?.values?.name}总结了群聊内容`,
    }[key] ?? key),
}));

import { MessageContentTypeConst } from "../../../Service/Const";
import { SummaryNotifyCell, SummaryNotifyContent } from "../index";

describe("SummaryNotifyContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChannelInfo.mockReturnValue(undefined);
  });

  it("uses content type 21 and preserves the display fallback fields", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice";
    expect(content.contentType).toBe(MessageContentTypeConst.summaryNotify);
    expect(content.encodeJSON()).toEqual({
      from_uid: "alice",
      from_name: "Alice",
    });

    const decoded = new SummaryNotifyContent();
    decoded.decodeJSON({ from_uid: " alice ", from_name: " Alice " });
    expect(decoded.fromUID).toBe("alice");
    expect(decoded.fromName).toBe("Alice");
  });

  it("resolves identity from the authenticated envelope sender", () => {
    getChannelInfo.mockImplementation((_sdk, channel) => ({
      orgData: {
        displayName:
          channel.channelID === "alice" ? "Alice Profile" : "Mallory",
      },
    }));
    const content = new SummaryNotifyContent();
    content.fromUID = "mallory";
    content.fromName = "Mallory";
    const cell = new SummaryNotifyCell({
      message: { fromUID: "alice", content },
    } as any);

    expect((cell.render() as any).props.children).toBe(
      "Alice Profile总结了群聊内容"
    );
  });

  it("uses from_name only as a display fallback and fetches the real profile", () => {
    const content = new SummaryNotifyContent();
    content.fromUID = "alice";
    content.fromName = "Alice Fallback";

    expect(content.tipForSender("alice")).toBe("Alice Fallback总结了群聊内容");
    expect(fetchChannelInfo).toHaveBeenCalledTimes(1);
  });

  it("keeps the conversation digest sender-neutral", () => {
    const content = new SummaryNotifyContent();
    expect(content.tipForSender("me")).toBe("你总结了群聊内容");
    expect(content.conversationDigest).toBe("总结了群聊内容");
  });
});
