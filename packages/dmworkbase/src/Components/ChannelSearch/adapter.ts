import type { ChannelSearchDataSource } from "./types";

export const channelSearchEmptyDataSource: ChannelSearchDataSource = {
  getSenders: () => [],
  getSender: (uid) => ({
    uid,
    name: uid,
  }),
  searchMessages: async () => ({
    items: [],
    hasMore: false,
  }),
};
