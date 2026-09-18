import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { APIClient } from "@octo/base";
import { DocumentSourceService } from "./DocumentSourceService";

describe("DocumentSourceService", () => {
  it("skips malformed rows and normalizes display fields without losing valid documents", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        null, 123, "bad", [], {}, { docId: 123 }, { docId: "  " },
        { docId: "bad-type", docType: {} },
        { docId: "doc-1", title: {}, spaceId: 42 },
        { docId: "html-1", title: "HTML", docType: "html", spaceId: "space-1" },
      ],
      nextCursor: "next-page",
    });
    const result = await new DocumentSourceService({ list }).listDocuments("recent", "");
    expect(result.items).toEqual([
      { docId: "doc-1", title: "doc-1", docType: "doc", updatedAt: null, spaceId: undefined },
      { docId: "html-1", title: "HTML", docType: "html", updatedAt: null, spaceId: "space-1" },
    ]);
    expect(result.nextPage).toEqual({ cursor: "next-page" });
  });

  it("retains raw page length for continuation even when every row is invalid", async () => {
    const list = vi.fn().mockResolvedValue({ items: Array(50).fill(null) });
    expect(await new DocumentSourceService({ list }).listDocuments("mine", "")).toEqual({
      items: [], total: null, nextPage: { page: 2 },
    });
  });

  it.each([null, undefined, [], "invalid", {}, { total: 0 }, { items: {} }, { items: "invalid" }, { items: null }])(
    "rejects a malformed page instead of returning false empty success (%j)",
    async (response) => {
      const list = vi.fn().mockResolvedValue(response);
      await expect(new DocumentSourceService({ list }).listDocuments("recent", "")).rejects.toThrow("Invalid document list response");
    }
  );

  it.each([
    ["2026-09-17T01:02:03.000Z", Date.parse("2026-09-17T01:02:03.000Z")],
    [1770000000000, 1770000000000],
    [1770000000, null],
    ["1770000000000", null],
    ["123", null],
    [NaN, null],
    [Infinity, null],
    [-1, null],
    [1e14, null],
    ["not-a-date", null],
    [null, null],
    [{}, null],
  ])("normalizes date %j to %j without guessing timestamp units", async (updatedAt, expected) => {
    const list = vi.fn().mockResolvedValue({ items: [{ docId: "doc-1", updatedAt }] });
    const result = await new DocumentSourceService({ list }).listDocuments("recent", "");
    expect(result.items[0].updatedAt).toBe(expected);
  });

  it("lists recent documents with doc/html filters at the service boundary", async () => {
    const list = vi.fn().mockResolvedValue({
      total: 2,
      items: [
        {
          docId: "doc-1",
          title: "Doc",
          docType: "doc",
          updatedAt: "2026-09-17T01:02:03.000Z",
          spaceId: "space-1",
        },
        {
          docId: "sheet-1",
          title: "Sheet",
          docType: "sheet",
          updatedAt: 1,
        },
      ],
    });
    const service = new DocumentSourceService({ list });

    await expect(service.listDocuments("recent", " 项目 ")).resolves.toEqual({
      total: 2,
      nextPage: null,
      items: [
        {
          docId: "doc-1",
          title: "Doc",
          docType: "doc",
          updatedAt: Date.parse("2026-09-17T01:02:03.000Z"),
          spaceId: "space-1",
        },
      ],
    });
    expect(list).toHaveBeenCalledWith("recent", {
      pageSize: 50,
      type: ["doc", "html"],
      q: "项目",
    });
  });

  it("lists my documents with owner, sort, page, and doc/html filters", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: undefined });
    const service = new DocumentSourceService({ list });

    await expect(service.listDocuments("mine", "")).resolves.toEqual({
      total: null,
      nextPage: null,
      items: [],
    });
    expect(list).toHaveBeenCalledWith("mine", {
      owner: "me",
      page: 1,
      pageSize: 50,
      sort: "updatedAt:desc",
      type: ["doc", "html"],
    });
  });

  it("uses the recent cursor even without a total and passes it unchanged", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: "opaque+/=" })
      .mockResolvedValueOnce({ items: [], nextCursor: null, total: 100 });
    const service = new DocumentSourceService({ list });
    const first = await service.listDocuments("recent", "");
    expect(first.nextPage).toEqual({ cursor: "opaque+/=" });
    const last = await service.listDocuments("recent", "", first.nextPage!);
    expect(list).toHaveBeenLastCalledWith("recent", {
      pageSize: 50,
      type: ["doc", "html"],
      cursor: "opaque+/=",
    });
    expect(last.nextPage).toBeNull();
  });

  it("does not invent a recent page from total or loop on a repeated cursor", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 200 });
    const service = new DocumentSourceService({ list });
    expect((await service.listDocuments("recent", "")).nextPage).toBeNull();
    list.mockResolvedValue({ items: [], nextCursor: "same" });
    expect(
      (await service.listDocuments("recent", "", { cursor: "same" })).nextPage
    ).toBeNull();
  });

  it.each([49, 50, 51, 100, 101])(
    "uses page boundaries for mine with total %i",
    async (total) => {
      const list = vi
        .fn()
        .mockResolvedValue({ total, items: [{ docId: "d", docType: "doc" }] });
      const service = new DocumentSourceService({ list });
      expect((await service.listDocuments("mine", "")).nextPage).toEqual(
        total > 50 ? { page: 2 } : null
      );
      expect(
        (await service.listDocuments("mine", " title ", { page: 2 })).nextPage
      ).toEqual(total > 100 ? { page: 3 } : null);
      expect(list).toHaveBeenLastCalledWith("mine", {
        owner: "me",
        page: 2,
        pageSize: 50,
        sort: "updatedAt:desc",
        type: ["doc", "html"],
        q: "title",
      });
    }
  );

  it.each([undefined, -1, NaN, Infinity])(
    "falls back to full raw pages for invalid/missing total %s",
    async (total) => {
      const list = vi.fn().mockResolvedValue({
        total,
        items: Array.from({ length: 50 }, (_, i) => ({
          docId: `d-${i}`,
          docType: "doc",
        })),
      });
      const service = new DocumentSourceService({ list });
      expect((await service.listDocuments("mine", "")).nextPage).toEqual({
        page: 2,
      });
      list.mockResolvedValue({ items: [] });
      expect(
        (await service.listDocuments("mine", "", { page: 2 })).nextPage
      ).toBeNull();
    }
  );

  it("does not compare total with client-filtered rows or stop a full filtered page early", async () => {
    const list = vi.fn().mockResolvedValue({
      total: 2,
      items: [
        { docId: "doc", docType: "doc" },
        { docId: "sheet", docType: "sheet" },
      ],
    });
    const service = new DocumentSourceService({ list });
    expect((await service.listDocuments("mine", "")).nextPage).toBeNull();
    list.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, i) => ({
        docId: `sheet-${i}`,
        docType: "sheet",
      })),
    });
    const page = await service.listDocuments("mine", "");
    expect(page.items).toEqual([]);
    expect(page.nextPage).toEqual({ page: 2 });
  });

  it("pins the production transport parameters through the installed axios URL serializer", async () => {
    const originalGet = Object.getOwnPropertyDescriptor(
      APIClient.shared,
      "get"
    );
    const get = vi.fn().mockResolvedValue({ items: [], total: 0 });
    Object.defineProperty(APIClient.shared, "get", {
      value: get,
      configurable: true,
      writable: true,
    });
    try {
      await new DocumentSourceService().listDocuments("mine", "项目 & plan", {
        page: 2,
      });
      expect(get).toHaveBeenCalledWith("docs", {
        param: {
          owner: "me",
          page: 2,
          pageSize: 50,
          sort: "updatedAt:desc",
          type: ["doc", "html"],
          q: "项目 & plan",
        },
      });
      const uri = axios.getUri({
        url: "https://example.invalid/docs",
        params: get.mock.calls[0][1]!.param,
      });
      const query = new URL(uri).searchParams;
      // Express 4's extended query parser accepts axios 0.25's bracket arrays.
      // This pins the actual wire encoding, not just a hand-written query object.
      expect(query.getAll("type[]")).toEqual(["doc", "html"]);
      expect(query.get("owner")).toBe("me");
      expect(query.get("page")).toBe("2");
      expect(query.get("q")).toBe("项目 & plan");
    } finally {
      if (originalGet)
        Object.defineProperty(APIClient.shared, "get", originalGet);
      else Reflect.deleteProperty(APIClient.shared, "get");
    }
  });
});
