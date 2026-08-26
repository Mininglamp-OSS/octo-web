import type { Channel } from "wukongimjssdk";

import APIClient from "./APIClient";

export interface PinnedChannelItem {
  channel_id: string;
  channel_type: number;
  sort_order: number;
}

const PinnedService = {
  add(channel: Channel): Promise<void> {
    return APIClient.shared.post("/user/pinned", {
      channel_id: channel.channelID,
      channel_type: channel.channelType,
    });
  },

  remove(channel: Channel): Promise<void> {
    return APIClient.shared.delete("/user/pinned", {
      param: {
        channel_id: channel.channelID,
        channel_type: channel.channelType,
      },
    });
  },

  list(): Promise<PinnedChannelItem[]> {
    return APIClient.shared.get("/user/pinned") as Promise<PinnedChannelItem[]>;
  },
};

export default PinnedService;
