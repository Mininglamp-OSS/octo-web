import { describe, expect, it, vi } from "vitest";
import { DocumentSourceService } from "./DocumentSourceService";

describe("DocumentSourceService", () => {
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
      total: 0,
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
});
