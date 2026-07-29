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

  it("posts cloud-docs search with the {q,pageSize} body (no cursor on the first page) and normalizes the response", async () => {
    postMock.mockResolvedValue({
      total: 2,
      items: [
        { docId: "d1", title: "A", docType: "doc", updatedAt: 1 },
        { docId: "d2", title: "B", docType: "sheet", updatedAt: 2 },
      ],
      nextCursor: "cur-2",
    });

    const result = await SearchService.searchDocs({
      keyword: "spec",
      pageSize: 20,
    });

    // First page: cursor omitted entirely (backend starts from the top).
    expect(postMock).toHaveBeenCalledWith("docs/search", {
      q: "spec",
      pageSize: 20,
    });
    expect(result).toEqual({
      total: 2,
      items: [
        { docId: "d1", title: "A", docType: "doc", updatedAt: null },
        { docId: "d2", title: "B", docType: "sheet", updatedAt: null },
      ],
      nextCursor: "cur-2",
    });
  });

  it("sends the cursor in the body only when provided (next page)", async () => {
    postMock.mockResolvedValue({ total: 0, items: [] });
    await SearchService.searchDocs({
      keyword: "x",
      pageSize: 20,
      cursor: "cur-2",
    });
    expect(postMock).toHaveBeenCalledWith("docs/search", {
      q: "x",
      pageSize: 20,
      cursor: "cur-2",
    });
  });

  it("nextCursor: reads a non-empty string, else undefined; total falls back to the visible item count", async () => {
    // Keyset paging: the pager stops on !nextCursor, so an absent/empty/non-string
    // nextCursor must normalize to undefined. total is display-only; when it is
    // missing or non-numeric we fall back to the visible item count (never
    // Infinity — that was the offset-era hack the pager no longer needs).
    postMock.mockResolvedValue({
      items: [{ docId: "d1", title: "A", docType: "doc", updatedAt: 0 }],
    });
    const noTotal = await SearchService.searchDocs({ keyword: "x", pageSize: 20 });
    expect(noTotal.total).toBe(1);
    expect(noTotal.nextCursor).toBeUndefined();
    expect(noTotal.items).toEqual([
      { docId: "d1", title: "A", docType: "doc", updatedAt: null },
    ]);

    postMock.mockResolvedValue({ total: "nope", nextCursor: "" });
    const bad = await SearchService.searchDocs({ keyword: "x", pageSize: 20 });
    expect(bad).toEqual({ total: 0, items: [], nextCursor: undefined });
  });

  it("coerces highlight to string-or-undefined (a non-string can't reach renderHighlight)", async () => {
    postMock.mockResolvedValue({
      total: 4,
      items: [
        { docId: "a", title: "A", docType: "doc", highlight: "<em>hit</em>" }, // string kept
        { docId: "b", title: "B", docType: "doc", highlight: 123 }, // number -> undefined
        { docId: "c", title: "C", docType: "doc", highlight: { x: 1 } }, // object -> undefined
        { docId: "d", title: "D", docType: "doc" }, // absent -> undefined
      ],
    });
    const result = await SearchService.searchDocs({ keyword: "x", pageSize: 20 });
    expect(result.items.map((it) => it.highlight)).toEqual([
      "<em>hit</em>",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("coerces updatedAt to plausible-millis-or-null (contract: number | null)", async () => {
    postMock.mockResolvedValue({
      total: 5,
      items: [
        { docId: "a", title: "A", docType: "doc", updatedAt: 1710000000000 }, // valid millis
        { docId: "b", title: "B", docType: "doc", updatedAt: 0 }, // falsy -> null
        { docId: "c", title: "C", docType: "doc", updatedAt: 1700000000 }, // seconds-scale -> null
        { docId: "d", title: "D", docType: "doc", updatedAt: "2024-01-01" }, // non-number -> null
        { docId: "e", title: "E", docType: "doc", updatedAt: null }, // null stays null
      ],
    });
    const result = await SearchService.searchDocs({ keyword: "x", pageSize: 20 });
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
    const result = await SearchService.searchDocs({ keyword: "x", pageSize: 20 });
    // updatedAt:0 is coerced to null per the number|null contract.
    expect(result.items).toEqual([{ docId: "d1", title: "A", docType: "doc", updatedAt: null }]);
    // total is display-only and passed through verbatim under keyset paging;
    // there is no rawItemCount channel anymore — the pager relies on nextCursor.
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBeUndefined();
  });
});
