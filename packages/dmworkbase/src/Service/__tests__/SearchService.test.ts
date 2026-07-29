import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      get: getMock,
      post: postMock,
    },
  },
}));

import SearchService, {
  channelSearchEndpoint,
  globalSearchEndpoint,
  toChannelSearchRequestBody,
  toGlobalRequestBody,
} from "../SearchService";
import type { ChannelSearchQuery, GlobalSearchQuery } from "../SearchTypes";

const channelQuery = (
  tab: ChannelSearchQuery["tab"] = "all"
): ChannelSearchQuery => ({
  channelId: "group-a",
  channelType: 2,
  keyword: "  project  ",
  tab,
  filters: {
    senderUids: ["u1"],
    sort: "time_desc",
    startAt: Math.floor(new Date(2026, 0, 2).getTime() / 1000),
  },
  cursor: "cursor-1",
  limit: 20,
});

const globalQuery = (
  tab: GlobalSearchQuery["tab"] = "messages"
): GlobalSearchQuery => ({
  tab,
  keyword: "project",
  filters: {
    senderUids: ["u1"],
    memberUids: ["self", "u2", "u2"],
    channels: [{ channelId: "group-a", channelType: 2 }],
    channelTypes: [2, 5],
    contentTypes: [1, 2, 5],
    fileExts: [],
    sort: "relevance",
  },
  cursor: "cursor-2",
  limit: 20,
});

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("SearchService request boundaries", () => {
  it("selects channel-search endpoints and preserves request semantics", () => {
    expect(channelSearchEndpoint("all")).toBe("messages/_search_all");
    expect(channelSearchEndpoint("message")).toBe("messages/_search");
    expect(channelSearchEndpoint("media")).toBe("messages/_search_media");
    expect(channelSearchEndpoint("file")).toBe("messages/_search_files");

    expect(toChannelSearchRequestBody(channelQuery())).toMatchObject({
      channel_id: "group-a",
      channel_type: 2,
      keyword: "project",
      filters: { sender_ids: ["u1"], sent_at_from: "2026-01-02" },
      sort: "time_desc",
      page_size: 20,
      cursor: "cursor-1",
    });
  });

  it("posts channel search and maps the response envelope", async () => {
    postMock.mockResolvedValue({
      data: [
        {
          result_type: "message",
          message: {
            message_id: "m1",
            message_seq: 7,
            sender_id: "u1",
            sender_avatar_url: "users/u1/avatar",
            sent_at: "2026-01-02T00:00:00Z",
          },
        },
      ],
      pagination: { has_more: true, next_cursor: "next" },
    });

    const result = await SearchService.searchChannelMessages(channelQuery(), {
      image: (path) => `/images/${path}`,
      file: (path) => `/files/${path}`,
    });

    expect(postMock).toHaveBeenCalledWith(
      "messages/_search_all",
      toChannelSearchRequestBody(channelQuery())
    );
    expect(result).toMatchObject({
      hasMore: true,
      nextCursor: "next",
      items: [
        {
          messageId: "m1",
          messageSeq: 7,
          sender: { uid: "u1", avatarUrl: "/images/users/u1/avatar" },
        },
      ],
    });
  });

  it("posts global content search with filters and cancellation", async () => {
    const controller = new AbortController();
    const query = { ...globalQuery(), signal: controller.signal };
    postMock.mockResolvedValue({ data: [], pagination: { has_more: false } });

    await SearchService.searchGlobalMessages(query, "self");

    expect(globalSearchEndpoint("messages")).toBe(
      "messages/_search_global_messages"
    );
    expect(globalSearchEndpoint("files")).toBe("messages/_search_global_files");
    expect(postMock).toHaveBeenCalledWith(
      "messages/_search_global_messages",
      toGlobalRequestBody(query, "self"),
      { signal: controller.signal }
    );
    expect(toGlobalRequestBody(query, "self")).toMatchObject({
      keyword: "project",
      filters: {
        sender_ids: ["u1"],
        member_uids: ["u2"],
        content_types: [1],
      },
    });
  });

  it("normalizes global file-type response envelopes", async () => {
    const categories = [{ key: "docs", label: "Docs", exts: ["pdf"] }];
    getMock.mockResolvedValue({ data: categories });

    await expect(SearchService.getGlobalFileTypes()).resolves.toEqual(
      categories
    );
    expect(getMock).toHaveBeenCalledWith("messages/_search_file_types", {
      signal: undefined,
    });
  });

  it("keeps legacy global search path, Space query, and channel params", async () => {
    postMock.mockResolvedValue({});

    await expect(
      SearchService.searchLegacyGlobal({
        keyword: "hello",
        page: 2,
        limit: 20,
        contentTypes: [4],
        channelId: "group-a",
        channelType: 2,
        onlyMessage: true,
        spaceId: "space/a",
      })
    ).resolves.toMatchObject({ friends: [], groups: [], messages: [] });

    expect(postMock).toHaveBeenCalledWith("/search/global?space_id=space%2Fa", {
      keyword: "hello",
      page: 2,
      limit: 20,
      content_type: [4],
      channel_id: "group-a",
      channel_type: 2,
      only_message: 1,
    });
  });

  it("posts cloud-docs search with the {q,page,pageSize} body and normalizes the response", async () => {
    postMock.mockResolvedValue({
      total: 2,
      items: [
        { docId: "d1", title: "A", docType: "doc", updatedAt: 1 },
        { docId: "d2", title: "B", docType: "sheet", updatedAt: 2 },
      ],
    });

    const result = await SearchService.searchDocs({
      keyword: "spec",
      page: 1,
      pageSize: 20,
    });

    expect(postMock).toHaveBeenCalledWith("docs/search", {
      q: "spec",
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({
      total: 2,
      items: [
        { docId: "d1", title: "A", docType: "doc", updatedAt: 1 },
        { docId: "d2", title: "B", docType: "sheet", updatedAt: 2 },
      ],
      rawItemCount: 2,
    });
  });

  it("includes docType in the body only when provided", async () => {
    postMock.mockResolvedValue({ total: 0, items: [] });
    await SearchService.searchDocs({
      keyword: "x",
      page: 1,
      pageSize: 20,
      docType: ["doc", "sheet"],
    });
    expect(postMock).toHaveBeenCalledWith("docs/search", {
      q: "x",
      page: 1,
      pageSize: 20,
      docType: ["doc", "sheet"],
    });
  });

  it("does not clamp total to items.length when total is not a number (uses Infinity so a full page still paginates), and defaults items to []", async () => {
    // Contract: `total` is an exact post-visibility count and is always a
    // number in practice. If it is ever absent, we must NOT fall back to
    // items.length (that caps a full first page at one page); we use Infinity
    // and let the full-page signal drive hasMore. updatedAt:0 coerces to null.
    postMock.mockResolvedValue({ items: [{ docId: "d1", title: "A", docType: "doc", updatedAt: 0 }] });
    const withItems = await SearchService.searchDocs({ keyword: "x", page: 1, pageSize: 20 });
    expect(withItems.total).toBe(Number.POSITIVE_INFINITY);
    expect(withItems.items).toEqual([{ docId: "d1", title: "A", docType: "doc", updatedAt: null }]);

    postMock.mockResolvedValue({ total: "nope" });
    const noItems = await SearchService.searchDocs({ keyword: "x", page: 1, pageSize: 20 });
    expect(noItems).toEqual({
      total: Number.POSITIVE_INFINITY,
      items: [],
      rawItemCount: 0,
    });
  });

  it("coerces updatedAt to positive-millis-or-null (contract: number | null)", async () => {
    postMock.mockResolvedValue({
      total: 5,
      items: [
        { docId: "a", title: "A", docType: "doc", updatedAt: 1710000000000 }, // valid millis
        { docId: "b", title: "B", docType: "doc", updatedAt: 0 }, // falsy -> null
        { docId: "c", title: "C", docType: "doc", updatedAt: -1 }, // <=0 -> null
        { docId: "d", title: "D", docType: "doc", updatedAt: "2024-01-01" }, // non-number -> null
        { docId: "e", title: "E", docType: "doc", updatedAt: null }, // null stays null
      ],
    });
    const result = await SearchService.searchDocs({ keyword: "x", page: 1, pageSize: 20 });
    expect(result.items.map((it) => it.updatedAt)).toEqual([
      1710000000000,
      null,
      null,
      null,
      null,
    ]);
  });

  it("drops items missing a usable docId so /d/undefined and key collisions are impossible", async () => {
    postMock.mockResolvedValue({
      total: 3,
      items: [
        { docId: "d1", title: "A", docType: "doc", updatedAt: 0 },
        { title: "no id", docType: "doc", updatedAt: 0 },
        { docId: "", title: "empty id", docType: "doc", updatedAt: 0 },
      ],
    });
    const result = await SearchService.searchDocs({ keyword: "x", page: 1, pageSize: 20 });
    // updatedAt:0 is coerced to null per the number|null contract.
    expect(result.items).toEqual([{ docId: "d1", title: "A", docType: "doc", updatedAt: null }]);
    // rawItemCount preserves the backend's pre-filter page size so the pager
    // can tell a client-side drop apart from a genuine short final page.
    expect(result.rawItemCount).toBe(3);
  });
});
