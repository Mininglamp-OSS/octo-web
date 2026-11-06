import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../APIClient", () => ({ default: { shared: api } }));
import NameSearchService, { parseNameSearchPage } from "../NameSearchService";
import type { NameSearchQuery } from "../NameSearchTypes";

const wirePage = () => ({
  items: [
    {
      id: "u1",
      kind: "contact",
      contact_type: "human",
      original_name: "😀向东",
      remark_name: "同事",
      display_name: "同事",
      matches: { original: [{ start: 1, end: 2 }], remark: [] },
    },
  ],
  next_cursor: "next",
  has_more: true,
  complete: true,
  total: 52,
  incomplete_reasons: [],
  rules_version: "s14-v1",
  result_revision: "rev1",
});

describe("NameSearchService", () => {
  it("searches authorized threads and preserves parent identity", async () => {
    api.post.mockResolvedValue({
      ...wirePage(),
      items: [
        {
          id: "g____s",
          kind: "thread",
          parent_id: "g",
          archived: true,
          original_name: "向晨瑜",
          remark_name: "",
          display_name: "向晨瑜",
          matches: { original: [{ start: 0, end: 3 }], remark: [] },
        },
      ],
    });
    const page = await NameSearchService.searchThreads({
      keyword: "xcy",
      spaceId: "A",
      entry: "name_selector",
      scope: "summary_source",
      includeArchived: true,
    });
    expect(page.items[0]).toMatchObject({
      kind: "thread",
      parentId: "g",
      archived: true,
    });
    expect(api.post).toHaveBeenCalledWith(
      "search/threads",
      expect.objectContaining({
        scope: "summary_source",
        include_archived: true,
      }),
      expect.anything()
    );
  });

  beforeEach(() => {
    api.post.mockReset();
  });
  it("sends captured Space and maps names and codepoint ranges without reordering", async () => {
    api.post.mockResolvedValue(wirePage());
    const abort = new AbortController();
    const page = await NameSearchService.searchContacts(
      {
        keyword: "向",
        spaceId: "A",
        entry: "global",
        contactType: "human",
        pageSize: 3,
      },
      abort.signal
    );
    expect(api.post).toHaveBeenCalledWith(
      "search/contacts",
      expect.objectContaining({
        keyword: "向",
        space_id: "A",
        entry: "global",
        contact_type: "human",
        page_size: 3,
      }),
      expect.objectContaining({
        signal: abort.signal,
        suppressSpaceId: true,
        headers: { "X-Space-Id": "A" },
      })
    );
    expect(page.items[0]).toMatchObject({
      id: "u1",
      originalName: "😀向东",
      remarkName: "同事",
      displayName: "同事",
      matches: { original: [{ start: 1, end: 2 }], remark: [] },
    });
    expect(page).toMatchObject({
      total: 52,
      hasMore: true,
      nextCursor: "next",
      resultRevision: "rev1",
    });
  });
  it("explicit no-Space suppresses the global header and preserves partial coverage", async () => {
    api.post.mockResolvedValue({
      ...wirePage(),
      complete: false,
      total: null,
      incomplete_reasons: ["type_pending"],
    });
    const page = await NameSearchService.searchContacts({
      keyword: "向",
      spaceId: null,
      entry: "address_book",
    });
    expect(api.post).toHaveBeenCalledWith(
      "search/contacts",
      expect.objectContaining({ space_id: null }),
      expect.objectContaining({ suppressSpaceId: true, headers: {} })
    );
    expect(page.complete).toBe(false);
    expect(page.total).toBeNull();
    expect(page.incompleteReasons).toEqual(["type_pending"]);
  });
  it("rejects incomplete eligibility without an explicit candidate set", async () => {
    await expect(
      NameSearchService.searchContacts({
        keyword: "向",
        spaceId: "A",
        entry: "name_selector",
        allowedIdsComplete: false,
      })
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects oversized range lists before mapping and merges valid overlaps", () => {
    const wire = wirePage();
    wire.items[0].matches.original = Array.from({ length: 4097 }, () => ({
      start: 1,
      end: 2,
    }));
    expect(() => parseNameSearchPage(wire, "contact")).toThrow();
    wire.items[0].matches.original = [
      { start: 2, end: 3 },
      { start: 1, end: 3 },
      { start: 1, end: 2 },
    ];
    expect(
      parseNameSearchPage(wire, "contact").items[0].matches.original
    ).toEqual([{ start: 1, end: 3 }]);
  });
  it.each(["group", "thread"] as const)(
    "rejects contact metadata on %s results",
    (kind) => {
      const wire = wirePage();
      Object.assign(wire.items[0], {
        kind,
        contact_type: "unexpected",
        parent_id: "g",
      });
      expect(() => parseNameSearchPage(wire, kind)).toThrow();
    }
  );
  it.each([
    { scope: "thread_filter" },
    { scope: "thread_filter", channelId: "g", channelType: 5 },
    { scope: "member", channelId: "g", channelType: 5 },
    { scope: "summary_source", channelId: "g", channelType: 2 },
    { scope: "directory", allowedIds: "not-an-array" },
    { scope: "directory", allowedIds: [1] },
    { scope: "directory", allowedIdsComplete: "false" },
    { scope: "directory", includeArchived: "false" },
    { scope: "directory", cursor: 42 },
    { scope: "directory", contactType: "unexpected" },
  ])(
    "rejects malformed runtime query context %j without sending",
    async (fields) => {
      const query = {
        keyword: "向",
        spaceId: "A",
        entry: "name_selector",
        ...fields,
      } as unknown as NameSearchQuery;
      await expect(NameSearchService.searchContacts(query)).rejects.toThrow();
      expect(api.post).not.toHaveBeenCalled();
    }
  );

  it.each([{}, { channelId: "g", channelType: 5 }])(
    "rejects invalid thread-filter context on the thread endpoint: %j",
    async (fields) => {
      await expect(
        NameSearchService.searchThreads({
          keyword: "向",
          spaceId: "A",
          entry: "name_selector",
          scope: "thread_filter",
          ...fields,
        } as NameSearchQuery)
      ).rejects.toThrow();
      expect(api.post).not.toHaveBeenCalled();
    }
  );
  it("rejects overlong input without truncation or a request", async () => {
    await expect(
      NameSearchService.searchContacts({
        keyword: "😀".repeat(65),
        spaceId: null,
        entry: "global",
      })
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it("does not reinterpret a source error as an empty page", async () => {
    api.post.mockRejectedValue({ code: "err.server.search.name_query_failed" });
    await expect(
      NameSearchService.searchContacts({
        keyword: "向",
        spaceId: null,
        entry: "global",
      })
    ).rejects.toMatchObject({ code: "err.server.search.name_query_failed" });
  });
  it("rejects invalid ranges instead of highlighting a different character", async () => {
    const page = wirePage();
    page.items[0].matches.original = [{ start: 1, end: 99 }];
    api.post.mockResolvedValue(page);
    await expect(
      NameSearchService.searchContacts({
        keyword: "向",
        spaceId: null,
        entry: "global",
      })
    ).rejects.toThrow();
  });

  it("normalizes rejected aborted requests", async () => {
    const controller = new AbortController();
    api.post.mockImplementation(async () => {
      controller.abort();
      throw new Error("transport cancelled");
    });
    await expect(
      NameSearchService.searchContacts(
        { keyword: "向", spaceId: "A", entry: "global" },
        controller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("accepts valid thread filters and authorized member contexts", async () => {
    api.post.mockResolvedValue({
      ...wirePage(),
      items: [],
      next_cursor: "",
      has_more: false,
      total: 0,
    });
    await NameSearchService.searchThreads({
      keyword: "向",
      spaceId: "A",
      entry: "name_selector",
      scope: "thread_filter",
      channelId: "g",
      channelType: 2,
      includeArchived: true,
    });
    await NameSearchService.searchContacts({
      keyword: "向",
      spaceId: "A",
      entry: "name_selector",
      scope: "summary_member",
      channelId: "g____s",
      channelType: 5,
    });
    expect(api.post).toHaveBeenCalledTimes(2);
  });
  it("uses an independent group route and forwards the cursor", async () => {
    api.post.mockResolvedValue({
      ...wirePage(),
      items: [],
      has_more: false,
      next_cursor: "",
      total: 0,
    });
    await NameSearchService.searchGroups({
      keyword: "群",
      spaceId: "A",
      entry: "global",
      cursor: "cursor1",
    });
    expect(api.post).toHaveBeenCalledWith(
      "search/groups",
      expect.objectContaining({ cursor: "cursor1" }),
      expect.anything()
    );
  });
  it("sends an empty selectable set without expanding it to all candidates", async () => {
    api.post.mockResolvedValue({
      ...wirePage(),
      items: [],
      has_more: false,
      next_cursor: "",
      complete: false,
      total: null,
      incomplete_reasons: ["selection_pending"],
    });
    const page = await NameSearchService.searchContacts({
      keyword: "向",
      spaceId: "A",
      entry: "name_selector",
      allowedIds: [],
      allowedIdsComplete: false,
    });
    expect(api.post).toHaveBeenCalledWith(
      "search/contacts",
      expect.objectContaining({ allowed_ids: [], allowed_ids_complete: false }),
      expect.anything()
    );
    expect(page.complete).toBe(false);
    expect(page.total).toBeNull();
  });
});
