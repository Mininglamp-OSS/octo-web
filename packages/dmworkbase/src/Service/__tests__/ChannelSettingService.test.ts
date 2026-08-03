import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
} from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import APIClient from "../APIClient";
import { ChannelTypeCommunityTopic } from "../Const";
import { buildThreadChannelId } from "../Thread";
import {
  addChannelSubscribers,
  createChannel,
  exitChannel,
  leaveThread,
  removeChannelSubscribers,
  transferChannelOwner,
  updateChannelField,
  updateChannelSetting,
  updateChannelSubscriberAttr,
  updateThread,
} from "../ChannelSettingService";

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(() => Promise.resolve()),
      post: vi.fn(() => Promise.resolve()),
      put: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock("../SpacePrefix", () => ({
  hasSpacePrefix: vi.fn((id: string) => id.startsWith("s123_")),
}));

const apiDelete = APIClient.shared.delete as unknown as ReturnType<typeof vi.fn>;
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>;
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>;

describe("ChannelSettingService", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    apiPost.mockClear();
    apiPut.mockClear();
    apiDelete.mockResolvedValue(undefined);
    apiPost.mockResolvedValue(undefined);
    apiPut.mockResolvedValue(undefined);
  });

  it("updates group settings with group endpoint", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const setting = { mute: 1 };

    await updateChannelSetting(setting, channel);

    expect(apiPut).toHaveBeenCalledWith("groups/group-1/setting", setting);
  });

  it("updates person settings and strips space prefix", async () => {
    const channel = new Channel("s123_alice", ChannelTypePerson);
    const setting = { top: 1 };

    await updateChannelSetting(setting, channel);

    expect(apiPut).toHaveBeenCalledWith("users/alice/setting", setting);
  });

  it("updates thread settings with parent group endpoint", async () => {
    const channel = new Channel(
      buildThreadChannelId("group-1", "thread-1"),
      ChannelTypeCommunityTopic
    );
    const setting = { allow_no_mention: 0 };

    await updateChannelSetting(setting, channel);

    expect(apiPut).toHaveBeenCalledWith(
      "groups/group-1/threads/thread-1/setting",
      setting
    );
  });

  it("keeps invalid thread channel ids as no-op for compatibility", async () => {
    const channel = new Channel("bad-thread-id", ChannelTypeCommunityTopic);

    await updateChannelSetting({ mute: 1 }, channel);

    expect(apiPut).not.toHaveBeenCalled();
  });

  it("creates channels with optional metadata and space id", async () => {
    apiPost.mockResolvedValue({ group_no: "group-1" });

    const result = await createChannel(["self", "alice"], {
      avatarColor: 2,
      avatarText: "SA",
      categoryId: "cat-1",
      name: "Team",
      spaceId: "space-1",
    });

    expect(apiPost).toHaveBeenCalledWith("group/create", {
      members: ["self", "alice"],
      avatar_color: 2,
      avatar_text: "SA",
      category_id: "cat-1",
      name: "Team",
      space_id: "space-1",
    });
    expect(result).toEqual({ group_no: "group-1" });
  });

  it("adds and removes channel subscribers with legacy payloads", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);

    await addChannelSubscribers(channel, ["alice"]);
    await removeChannelSubscribers(channel, ["bob"]);

    expect(apiPost).toHaveBeenCalledWith("groups/group-1/members", {
      members: ["alice"],
    });
    expect(apiDelete).toHaveBeenCalledWith("groups/group-1/members", {
      data: {
        members: ["bob"],
      },
    });
  });

  it("updates channel fields and subscriber attributes", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);

    await updateChannelField(channel, "name", "New name");
    await updateChannelSubscriberAttr(channel, "alice", { remark: "A" });

    expect(apiPut).toHaveBeenCalledWith("groups/group-1", {
      name: "New name",
    });
    expect(apiPut).toHaveBeenCalledWith("groups/group-1/members/alice", {
      remark: "A",
    });
  });

  it("keeps person-only group mutations as no-op for compatibility", async () => {
    const channel = new Channel("alice", ChannelTypePerson);

    await transferChannelOwner(channel, "bob");
    await updateChannelSubscriberAttr(channel, "alice", { remark: "A" });
    await exitChannel(channel);

    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it("routes group owner transfer and exit to group endpoints", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);

    await transferChannelOwner(channel, "alice");
    await exitChannel(channel);

    expect(apiPost).toHaveBeenCalledWith("groups/group-1/transfer/alice");
    expect(apiPost).toHaveBeenCalledWith("groups/group-1/exit");
  });

  it("updates and leaves threads", async () => {
    await updateThread("group-1", "thread-1", { name: "Thread" });
    await leaveThread("thread-1");

    expect(apiPut).toHaveBeenCalledWith("groups/group-1/threads/thread-1", {
      name: "Thread",
    });
    expect(apiPost).toHaveBeenCalledWith("threads/thread-1/leave");
  });
});
