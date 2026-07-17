import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  post: vi.fn(),
  subscribers: vi.fn(),
  getChannelInfo: vi.fn(),
  getImageURL: vi.fn((path: string) => `/api/v1/${path}`),
  getFileURL: vi.fn((path: string) => `/files/${path}`),
  parseThreadChannelId: vi.fn(),
  searchChannelMessages: vi.fn(),
}));

vi.mock("../../../Service/SearchService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../Service/SearchService")
  >();
  return {
    ...actual,
    default: {
      ...actual.default,
      searchChannelMessages: mockState.searchChannelMessages,
    },
  };
});

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
        getFileURL: mockState.getFileURL,
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
  mapCombinedHit,
  mapMessageHit,
  normalizeItems,
  searchEndpoint,
  secondsToDateOnly,
  sentAtToSeconds,
  toRequestBody,
  countChannelSearchKeywordRunes,
  shouldRunSearch,
  truncateChannelSearchKeyword,
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
  mockState.searchChannelMessages.mockReset();
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

  it("limits keywords to 64 unicode code points before sending", () => {
    const keyword = `${"中".repeat(64)}尾`;
    const emojiKeyword = `${"😀".repeat(64)}tail`;

    expect(countChannelSearchKeywordRunes(emojiKeyword)).toBe(68);
    expect(
      countChannelSearchKeywordRunes(truncateChannelSearchKeyword(emojiKeyword))
    ).toBe(64);
    expect(toRequestBody({ ...baseQuery("message"), keyword })).toMatchObject({
      keyword: "中".repeat(64),
    });
    expect(
      toRequestBody({ ...baseQuery("file"), keyword: emojiKeyword })
    ).toMatchObject({
      keyword: "😀".repeat(64),
    });
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

  it("does not run all/message tabs with empty keyword and no filters", () => {
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

  it("maps media preview urls and normalizes thumb paths", () => {
    const item = mapMediaHit(
      {
        message_id: "video-1",
        message_seq: 33,
        media_kind: "video",
        media_url: "videos/video-1.mp4",
        download_url: "videos/video-1-download.mp4",
        preview_url: "videos/video-1-preview.mp4",
        thumb_url: "images/video-1-cover.jpg",
        duration_ms: 62000,
        sender_id: "u1",
        sent_at: "2026-01-02T00:00:00Z",
      },
      baseQuery("media")
    );

    expect(mockState.getFileURL).toHaveBeenCalledWith(
      "videos/video-1-preview.mp4"
    );
    expect(mockState.getFileURL).toHaveBeenCalledWith(
      "videos/video-1-download.mp4"
    );
    expect(mockState.getImageURL).toHaveBeenCalledWith(
      "images/video-1-cover.jpg"
    );
    expect(item).toMatchObject({
      kind: "video",
      media: {
        url: "/files/videos/video-1-preview.mp4",
        previewUrl: "/files/videos/video-1-preview.mp4",
        downloadUrl: "/files/videos/video-1-download.mp4",
        thumbUrl: "/api/v1/images/video-1-cover.jpg",
        duration: 62,
      },
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
          title: "Alice and Bob",
          child_count: 2,
        },
        inner_messages: [
          {
            message_id: "m-inner-1",
            type: 1,
            search_text: "命中的<mark>聊天</mark>记录正文",
            sender_id: "u2",
            sender_name: "Alice",
            sent_at: "2026-01-02T00:00:01Z",
          },
          {
            message_id: "m-inner-2",
            type: 8,
            search_text: "",
            sender_id: "u3",
          },
        ],
      },
      baseQuery("message")
    );

    expect(item).toMatchObject({
      kind: "merge_forward",
      text: "命中的<mark>聊天</mark>记录正文",
      matchReason: "命中的<mark>聊天</mark>记录正文",
      forward: {
        title: "Alice and Bob",
        snippets: [],
        innerMessages: [
          {
            messageId: "m-inner-1",
            type: 1,
            text: "命中的<mark>聊天</mark>记录正文",
            senderUid: "u2",
            senderName: "Alice",
            timestamp: 1767312001,
          },
          {
            messageId: "m-inner-2",
            type: 8,
            text: "",
            senderUid: "u3",
          },
        ],
        childCount: 2,
      },
    });
  });

  it("maps message-kind image and video hits from search_all browse mode", () => {
    const image = mapMessageHit(
      {
        message_id: "m-image",
        message_seq: 41,
        message_kind: "image",
        snippet: "野餐合影",
        thumb_url: "images/a.jpg",
        width: 1080,
        height: 720,
        sender_id: "u1",
        sent_at: "2026-01-02T00:00:00Z",
      },
      baseQuery("all")
    );
    const video = mapMessageHit(
      {
        message_id: "m-video",
        message_seq: 42,
        message_kind: "video",
        thumb_url: "videos/a-cover.jpg",
        width: 1280,
        height: 720,
        duration_ms: 42000,
        sender_id: "u2",
        sent_at: "2026-01-02T00:00:00Z",
      },
      baseQuery("all")
    );

    expect(image).toMatchObject({
      kind: "image",
      text: "野餐合影",
      matchReason: "野餐合影",
      media: {
        url: "/api/v1/images/a.jpg",
        previewUrl: "/api/v1/images/a.jpg",
        thumbUrl: "/api/v1/images/a.jpg",
        width: 1080,
        height: 720,
      },
    });
    expect(video).toMatchObject({
      kind: "video",
      media: {
        thumbUrl: "/api/v1/videos/a-cover.jpg",
        width: 1280,
        height: 720,
        duration: 42,
      },
    });
    expect(video.media?.url).toBeUndefined();
    expect(video.media?.previewUrl).toBeUndefined();
  });

  it("maps search_all message result media through the combined dispatcher", () => {
    expect(
      mapCombinedHit(
        {
          result_type: "message",
          sorted_at: "2026-01-03T00:00:00Z",
          message: {
            message_id: "m-image",
            message_seq: 41,
            message_kind: "image",
            thumb_url: "images/a.jpg",
            sender_id: "u1",
            sent_at: "2026-01-02T00:00:00Z",
          },
        },
        baseQuery("all")
      )
    ).toMatchObject({
      kind: "image",
      timestamp: 1767398400,
      media: {
        thumbUrl: "/api/v1/images/a.jpg",
      },
    });
  });

  it("keeps rich_text detail on text hits for structured rendering", () => {
    const item = mapMessageHit(
      {
        message_id: "m-richtext",
        message_seq: 43,
        message_kind: "text",
        snippet: "命中的<mark>哈哈</mark>片段",
        sender_id: "u1",
        sent_at: "2026-01-02T00:00:00Z",
        rich_text: {
          plain: "命中的哈哈片段[图片][文件] 需求.md",
          content: [
            { type: "text", text: "命中的哈哈片段" },
            {
              type: "image",
              url: "images/rich.png",
              width: 800,
              height: 600,
            },
            {
              type: "file",
              url: "files/spec.md",
              name: "需求.md",
              extension: "md",
              size: 2048,
            },
          ],
          mention: {
            entities: [{ uid: "u1", offset: 0, length: 3 }],
            all: 1,
            humans: 1,
          },
        },
      },
      baseQuery("message")
    );

    expect(item).toMatchObject({
      kind: "text",
      text: "命中的<mark>哈哈</mark>片段",
      matchReason: "命中的<mark>哈哈</mark>片段",
      richText: {
        plain: "命中的哈哈片段[图片][文件] 需求.md",
        content: [
          { type: "text", text: "命中的哈哈片段" },
          { type: "image", url: "images/rich.png" },
          { type: "file", name: "需求.md", extension: "md" },
        ],
        mention: {
          entities: [{ uid: "u1", offset: 0, length: 3 }],
          all: 1,
          humans: 1,
        },
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
    mockState.searchChannelMessages.mockResolvedValue({
      items: [
        {
          id: "m1",
          messageId: "m1",
          messageSeq: 22,
          channelId: "thread-a",
          channelType: 5,
          senderUid: "u1",
          timestamp: 1,
          kind: "text",
        },
      ],
      hasMore: true,
      nextCursor: "cursor-2",
    });

    const dataSource = createChannelSearchApiDataSource(
      new Channel("group-a", ChannelTypeGroup)
    );
    const response = await dataSource.searchMessages(baseQuery("all"));

    expect(mockState.searchChannelMessages).toHaveBeenCalledWith(
      baseQuery("all"),
      expect.objectContaining({
        image: expect.any(Function),
        file: expect.any(Function),
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
