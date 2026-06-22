import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  post: vi.fn(),
  subscribers: vi.fn(),
  getChannelInfo: vi.fn(),
  getImageURL: vi.fn((path: string) => `/api/v1/${path}`),
  parseThreadChannelId: vi.fn(),
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }

    isEqual(other: any) {
      return (
        this.channelID === other?.channelID &&
        this.channelType === other?.channelType
      );
    }

    getChannelKey() {
      return `${this.channelID}-${this.channelType}`;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  WKSDK: {
    shared: () => ({
      channelManager: {
        getChannelInfo: mockState.getChannelInfo,
      },
    }),
  },
}));

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "self",
      name: "Fallback Self",
      selfDisplayName: () => "Self Name",
    },
    shared: {
      avatarUser: (uid: string) => `/avatar/${uid}`,
    },
    apiClient: {
      config: { apiURL: "/api/v1/" },
      post: mockState.post,
    },
    dataSource: {
      commonDataSource: {
        getImageURL: mockState.getImageURL,
      },
      channelDataSource: {
        subscribers: mockState.subscribers,
      },
    },
  },
}));

vi.mock("../../../Service/Const", () => ({
  ChannelTypeCommunityTopic: 5,
}));

vi.mock("../../../Service/Thread", () => ({
  parseThreadChannelId: mockState.parseThreadChannelId,
}));

import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import {
  channelSearchApiAdapterTestUtils,
  createChannelSearchApiDataSource,
} from "../apiAdapter";
import type { ChannelSearchQuery } from "../types";

const {
  mapFileHit,
  mapMediaHit,
  mapMessageHit,
  normalizeItems,
  searchEndpoint,
  secondsToDateOnly,
  sentAtToSeconds,
  toRequestBody,
  shouldRunSearch,
} = channelSearchApiAdapterTestUtils;

function baseQuery(tab: ChannelSearchQuery["tab"]): ChannelSearchQuery {
  return {
    channelId: "group-a",
    channelType: ChannelTypeGroup,
    keyword: "  project  ",
    tab,
    filters: {
      senderUids: [],
      sort: "time_desc",
    },
    limit: 20,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.getChannelInfo.mockReturnValue({ title: "Peer Name" });
  mockState.parseThreadChannelId.mockReturnValue(null);
  mockState.subscribers.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("channel search API adapter request construction", () => {
  it("selects the backend endpoint per tab", () => {
    expect(searchEndpoint("all")).toBe("messages/_search_all");
    expect(searchEndpoint("message")).toBe("messages/_search");
    expect(searchEndpoint("media")).toBe("messages/_search_media");
    expect(searchEndpoint("file")).toBe("messages/_search_files");
  });

  it("sends keyword only for tabs that support keyword search", () => {
    expect(
      toRequestBody({ ...baseQuery("all"), keyword: "   " })
    ).toMatchObject({
      keyword: "",
    });
    expect(toRequestBody(baseQuery("message"))).toMatchObject({
      keyword: "project",
    });
    expect(toRequestBody(baseQuery("file"))).toMatchObject({
      keyword: "project",
    });
    expect(toRequestBody(baseQuery("media"))).not.toHaveProperty("keyword");
    expect(
      toRequestBody({ ...baseQuery("file"), keyword: "   " })
    ).not.toHaveProperty("keyword");
  });

  it("converts filters, pagination, and local day boundaries into request body", () => {
    const startAt = Math.floor(new Date(2026, 0, 5, 0, 0, 0).getTime() / 1000);
    const endAt = Math.floor(
      new Date(2026, 10, 9, 23, 59, 59).getTime() / 1000
    );

    expect(
      toRequestBody({
        ...baseQuery("message"),
        cursor: "next-cursor",
        limit: 30,
        filters: {
          senderUids: ["u1", "u2"],
          sort: "time_asc",
          startAt,
          endAt,
        },
      })
    ).toEqual({
      channel_type: ChannelTypeGroup,
      channel_id: "group-a",
      keyword: "project",
      filters: {
        sender_ids: ["u1", "u2"],
        sent_at_from: "2026-01-05",
        sent_at_to: "2026-11-09",
      },
      sort: "time_asc",
      page_size: 30,
      cursor: "next-cursor",
    });
  });
});

describe("channel search empty-state guard", () => {
  const noFilters = { senderUids: [], sort: "time_desc" as const };

  it("does not run all/message tabs with empty keyword and no filters (would 400)", () => {
    expect(
      shouldRunSearch({ keyword: "   ", filters: noFilters, tab: "all" })
    ).toBe(false);
    expect(
      shouldRunSearch({ keyword: "", filters: noFilters, tab: "message" })
    ).toBe(false);
  });

  it("runs all/message tabs once a keyword is present", () => {
    expect(
      shouldRunSearch({ keyword: "  hello  ", filters: noFilters, tab: "all" })
    ).toBe(true);
    expect(
      shouldRunSearch({ keyword: "hi", filters: noFilters, tab: "message" })
    ).toBe(true);
  });

  it("runs all/message tabs with a filter-only query (no keyword)", () => {
    expect(
      shouldRunSearch({
        keyword: "",
        filters: { senderUids: ["u1"], sort: "time_desc" },
        tab: "all",
      })
    ).toBe(true);
    const startAt = Math.floor(new Date(2026, 0, 5).getTime() / 1000);
    expect(
      shouldRunSearch({
        keyword: "",
        filters: { senderUids: [], sort: "time_desc", startAt },
        tab: "message",
      })
    ).toBe(true);
  });

  it("treats a sort-only change as not searchable (sort is not an effective filter)", () => {
    expect(
      shouldRunSearch({
        keyword: "",
        filters: { senderUids: [], sort: "time_asc" },
        tab: "all",
      })
    ).toBe(false);
  });

  it("always runs media and file tabs even with empty keyword and no filters", () => {
    expect(
      shouldRunSearch({ keyword: "", filters: noFilters, tab: "media" })
    ).toBe(true);
    expect(
      shouldRunSearch({ keyword: "", filters: noFilters, tab: "file" })
    ).toBe(true);
  });
});

describe("channel search API adapter response mapping", () => {
  it("preserves backend channel origin for message, file, and media hits", () => {
    const query = baseQuery("all");

    expect(
      mapMessageHit(
        {
          message_id: "m1",
          message_seq: 12,
          channel_id: "thread-a",
          channel_type: 5,
          sender_id: "u1",
          sent_at: "2026-01-02T00:00:00Z",
        },
        query
      )
    ).toMatchObject({
      channelId: "thread-a",
      channelType: 5,
      messageSeq: 12,
    });

    expect(
      mapFileHit(
        {
          message_id: "f1",
          message_seq: 13,
          channel_id: "thread-b",
          channel_type: 5,
          sender_id: "u2",
          sent_at: "2026-01-02T00:00:00Z",
        },
        query
      )
    ).toMatchObject({
      channelId: "thread-b",
      channelType: 5,
      messageSeq: 13,
      kind: "file",
    });

    expect(
      mapMediaHit(
        {
          message_id: "p1",
          message_seq: 14,
          channel_id: "thread-c",
          channel_type: 5,
          media_kind: "video",
          sender_id: "u3",
          sent_at: "2026-01-02T00:00:00Z",
        },
        query
      )
    ).toMatchObject({
      channelId: "thread-c",
      channelType: 5,
      messageSeq: 14,
      kind: "video",
    });
  });

  it("normalizes relative sender avatar paths from search hits", () => {
    const item = mapMessageHit(
      {
        message_id: "m1",
        message_seq: 12,
        sender_id: "u1",
        sender_name: "Alice",
        sender_avatar_url: "users/u1/avatar",
        sent_at: "2026-01-02T00:00:00Z",
      },
      baseQuery("message")
    );

    expect(mockState.getImageURL).toHaveBeenCalledWith("users/u1/avatar");
    expect(item.sender).toMatchObject({
      uid: "u1",
      name: "Alice",
      avatarUrl: "/api/v1/users/u1/avatar",
    });
  });

  it("keeps forward matches as inner hit text and outer preview metadata", () => {
    const item = mapMessageHit(
      {
        message_id: "m-forward",
        message_seq: 16,
        message_kind: "forward",
        snippet: "命中的<mark>聊天</mark>记录正文",
        sender_id: "u1",
        sent_at: "2026-01-02T00:00:00Z",
        outer_preview: {
          child_count: 2,
        },
      },
      baseQuery("message")
    );

    expect(item).toMatchObject({
      kind: "merge_forward",
      text: "命中的<mark>聊天</mark>记录正文",
      matchReason: "命中的<mark>聊天</mark>记录正文",
      forward: {
        title: "",
        snippets: [],
        childCount: 2,
      },
    });
  });

  it("normalizes bare-array and paginated response envelopes", () => {
    expect(normalizeItems([{ message_id: "m1" }])).toEqual({
      items: [{ message_id: "m1" }],
    });
    expect(
      normalizeItems({
        data: [{ message_id: "m2" }],
        pagination: { has_more: true, next_cursor: "cursor-2" },
      })
    ).toEqual({
      items: [{ message_id: "m2" }],
      pagination: { has_more: true, next_cursor: "cursor-2" },
    });
  });

  it("derives searchMessages pagination and request body from the envelope", async () => {
    mockState.post.mockResolvedValue({
      data: [
        {
          result_type: "message",
          sorted_at: "2026-01-03T00:00:00Z",
          message: {
            message_id: "m1",
            message_seq: 22,
            sender_id: "u1",
            channel_id: "thread-a",
            channel_type: 5,
            sent_at: "2026-01-02T00:00:00Z",
          },
        },
      ],
      pagination: { has_more: true, next_cursor: "cursor-2" },
    });

    const dataSource = createChannelSearchApiDataSource(
      new Channel("group-a", ChannelTypeGroup)
    );
    const response = await dataSource.searchMessages(baseQuery("all"));

    expect(mockState.post).toHaveBeenCalledWith(
      "messages/_search_all",
      expect.objectContaining({
        channel_id: "group-a",
        channel_type: ChannelTypeGroup,
        keyword: "project",
      })
    );
    expect(response).toMatchObject({
      nextCursor: "cursor-2",
      hasMore: true,
      items: [
        {
          messageId: "m1",
          messageSeq: 22,
          channelId: "thread-a",
          channelType: 5,
        },
      ],
    });
  });
});

describe("channel search API adapter date helpers", () => {
  it("formats date-only values in local calendar time", () => {
    const seconds = Math.floor(new Date(2026, 0, 5, 12, 0, 0).getTime() / 1000);
    expect(secondsToDateOnly(seconds)).toBe("2026-01-05");
  });

  it("falls back to the current time when sent_at is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
    expect(sentAtToSeconds("not-a-date")).toBe(
      Math.floor(new Date("2026-01-02T03:04:05Z").getTime() / 1000)
    );
  });
});

describe("channel search sender lookup", () => {
  it("filters one-to-one chat senders from self and peer", async () => {
    const dataSource = createChannelSearchApiDataSource(
      new Channel("peer", ChannelTypePerson)
    );

    await expect(dataSource.searchSenders?.("self")).resolves.toMatchObject([
      { uid: "self", name: "Self Name", isCurrentMember: true },
    ]);
    await expect(dataSource.searchSenders?.("peer")).resolves.toMatchObject([
      { uid: "peer", name: "Peer Name", isCurrentMember: true },
    ]);
    await expect(dataSource.searchSenders?.("missing")).resolves.toEqual([]);
  });

  it("queries current group subscribers", async () => {
    mockState.subscribers.mockResolvedValue([
      { uid: "u1", remark: "Alice", avatar: "/alice.png" },
      { uid: "u2", name: "Bob" },
    ]);
    const dataSource = createChannelSearchApiDataSource(
      new Channel("group-a", ChannelTypeGroup)
    );

    await expect(dataSource.searchSenders?.("a")).resolves.toMatchObject([
      { uid: "u1", name: "Alice", avatarUrl: "/alice.png" },
      { uid: "u2", name: "Bob", avatarUrl: "/avatar/u2" },
    ]);
    expect(mockState.subscribers).toHaveBeenCalledWith(
      expect.objectContaining({
        channelID: "group-a",
        channelType: ChannelTypeGroup,
      }),
      { keyword: "a", page: 1, limit: 50 }
    );
  });

  it("resolves topic sender lookup through the parent group", async () => {
    mockState.parseThreadChannelId.mockReturnValue({
      groupNo: "group-parent",
      shortId: "topic-a",
    });
    const dataSource = createChannelSearchApiDataSource(
      new Channel("group-parent@topic-a", 5)
    );

    await dataSource.searchSenders?.("alice");

    expect(mockState.subscribers).toHaveBeenCalledWith(
      expect.objectContaining({
        channelID: "group-parent",
        channelType: ChannelTypeGroup,
      }),
      { keyword: "alice", page: 1, limit: 50 }
    );
  });
});
