import { Channel } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import APIClient from "../APIClient";
import { ChannelTypeCommunityTopic } from "../Const";
import PinnedService from "../PinnedService";

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve([])),
      post: vi.fn(() => Promise.resolve()),
    },
  },
}));

const apiDelete = APIClient.shared.delete as unknown as ReturnType<
  typeof vi.fn
>;
const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>;

describe("PinnedService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pins a child thread through the dedicated pinned endpoint", async () => {
    const channel = new Channel(
      "group-1____thread-1",
      ChannelTypeCommunityTopic
    );

    await PinnedService.add(channel);

    expect(apiPost).toHaveBeenCalledWith("/user/pinned", {
      channel_id: "group-1____thread-1",
      channel_type: ChannelTypeCommunityTopic,
    });
  });

  it("unpins a child thread through the dedicated pinned endpoint", async () => {
    const channel = new Channel(
      "group-1____thread-1",
      ChannelTypeCommunityTopic
    );

    await PinnedService.remove(channel);

    expect(apiDelete).toHaveBeenCalledWith("/user/pinned", {
      param: {
        channel_id: "group-1____thread-1",
        channel_type: ChannelTypeCommunityTopic,
      },
    });
  });

  it("loads the persisted pinned-channel snapshot", async () => {
    await PinnedService.list();

    expect(apiGet).toHaveBeenCalledWith("/user/pinned");
  });
});
