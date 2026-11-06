import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { getNotificationSenderName } from "./notificationSender";
import { getImChannelInfo, getImChannelSubscribers } from "../../im-runtime/channelRuntime";

vi.mock("../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: vi.fn(), getImChannelSubscribers: vi.fn(),
}));
vi.mock("../../i18n", () => ({ t: () => "用户" }));

const message = { fromUID: "alice", channel: new Channel("project-group", ChannelTypeGroup) };

beforeEach(() => {
  vi.mocked(getImChannelInfo).mockReset();
  vi.mocked(getImChannelSubscribers).mockReset().mockReturnValue([]);
});

describe("notification sender metadata", () => {
  it("reads the person instead of using the group title", () => {
    vi.mocked(getImChannelInfo).mockReturnValue({ channel: new Channel("alice", ChannelTypePerson), title: "Alice" });
    expect(getNotificationSenderName(message)).toBe("Alice");
    expect(getImChannelInfo).toHaveBeenCalledWith(expect.anything(), new Channel("alice", ChannelTypePerson));
  });

  it("prefers a personal remark over a cached group member name", () => {
    vi.mocked(getImChannelInfo).mockReturnValue({ channel: new Channel("alice", ChannelTypePerson), title: "Alice", orgData: { remark: "My colleague", displayName: "My colleague" } });
    vi.mocked(getImChannelSubscribers).mockReturnValue([{ uid: "alice", name: "Group Alice" }]);
    expect(getNotificationSenderName(message)).toBe("My colleague");
  });

  it("uses group member identity when the person cache is incomplete", () => {
    vi.mocked(getImChannelSubscribers).mockReturnValue([{ uid: "other", name: "Other" }, { uid: "alice", name: "Group Alice" }]);
    expect(getNotificationSenderName(message)).toBe("Group Alice");
  });

  it("does not expose an unknown sender UID or substitute a conversation name", () => {
    expect(getNotificationSenderName(message)).toBe("用户");
  });

  it("uses the same person identity for direct and bot messages", () => {
    vi.mocked(getImChannelInfo).mockReturnValue({ channel: new Channel("bot", ChannelTypePerson), title: "Assistant" });
    expect(getNotificationSenderName({ fromUID: "bot", channel: new Channel("bot", ChannelTypePerson) })).toBe("Assistant");
    expect(getImChannelSubscribers).not.toHaveBeenCalled();
  });
});
