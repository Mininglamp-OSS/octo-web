import { beforeEach, describe, expect, it, vi } from "vitest";

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}));

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      post: postMock,
    },
  },
}));

import SearchService from "../SearchService";
import type { DriveSearchHit } from "../SearchTypes";

function hit(overrides: Partial<DriveSearchHit> = {}): DriveSearchHit {
  return {
    file_id: 1,
    space_id: "space-1",
    space_name: "共享空间",
    parent_id: 0,
    path: [],
    name: "file.md",
    type: "doc",
    owner_uid: "u1",
    owner_name: "Alex",
    updater_uid: "u1",
    updater_name: "Alex",
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-24T09:30:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  postMock.mockReset();
});

describe("SearchService.searchDrive", () => {
  it("posts search under the /api/drive/ prefix with the default offset body (page_index 0) and forwards the abort signal", async () => {
    postMock.mockResolvedValue({ total: 1, truncated: false, items: [hit()] });
    const controller = new AbortController();

    await SearchService.searchDrive({ q: "评审" }, controller.signal);

    expect(postMock).toHaveBeenCalledWith(
      "search",
      { q: "评审", scope: "all", page_index: 0, page_size: 20 },
      { signal: controller.signal, baseURL: "/api/drive/" }
    );
  });

  it("routes drive search to /api/drive/search (baseURL override + path combine)", async () => {
    postMock.mockResolvedValue({ total: 0, truncated: false, items: [] });

    await SearchService.searchDrive({ q: "x" });

    const [path, , config] = postMock.mock.calls[0];
    expect(path).toBe("search");
    expect(config.baseURL).toBe("/api/drive/");
    // The drive tab must resolve to the dedicated /api/drive proxy, NOT the
    // /api/v1 gateway; axios combines baseURL + path exactly like this.
    expect(`${config.baseURL}${path}`).toBe("/api/drive/search");
  });

  it("passes page_index / page_size / space_id / filters through when provided", async () => {
    postMock.mockResolvedValue({ total: 0, truncated: false, items: [] });

    await SearchService.searchDrive({
      q: "spec",
      scope: "space",
      space_id: "space-9",
      page_index: 2,
      page_size: 50,
      filters: { type: "doc" },
    });

    expect(postMock).toHaveBeenCalledWith(
      "search",
      {
        q: "spec",
        scope: "space",
        page_index: 2,
        page_size: 50,
        space_id: "space-9",
        filters: { type: "doc" },
      },
      { signal: undefined, baseURL: "/api/drive/" }
    );
  });

  it("drops hits without a numeric file_id or a non-empty string space_id", async () => {
    postMock.mockResolvedValue({
      total: 4,
      truncated: false,
      items: [
        hit({ file_id: 1 }),
        hit({ file_id: "2" as unknown as number }), // non-number -> dropped
        hit({ space_id: "" }), // empty space_id -> dropped
        null, // falsy -> dropped
      ],
    });

    const result = await SearchService.searchDrive({ q: "x" });
    expect(result.items.map((it) => it.file_id)).toEqual([1]);
    // total is passed through verbatim (display-only), not the filtered count.
    expect(result.total).toBe(4);
  });

  it("normalizes total (falls back to valid item count) and truncated (strict true)", async () => {
    postMock.mockResolvedValue({ items: [hit()], truncated: "yes" });
    const noTotal = await SearchService.searchDrive({ q: "x" });
    expect(noTotal.total).toBe(1); // no numeric total -> valid item count
    expect(noTotal.truncated).toBe(false); // only === true counts as truncated

    postMock.mockResolvedValue({ total: 8, truncated: true, items: [] });
    const truncated = await SearchService.searchDrive({ q: "x" });
    expect(truncated).toEqual({ total: 8, truncated: true, items: [] });
  });
});
