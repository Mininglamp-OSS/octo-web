import { describe, expect, it, vi, beforeEach } from "vitest";

// Mirror of expertService.addToLoop.test.ts's axios mock: expertService creates
// its own axios instance at module load, so mock the factory and pin the exact
// request shape. This file asserts the catalog list wire contract for the sort
// modes — the segmented sort control is only functional if the chosen mode
// actually reaches the backend as ?sort=… (the backend silently falls back to
// creation-time order for unknown/missing values, so a dropped param renders
// four visually-active but inert buttons).
const mock = vi.hoisted(() => ({
  logout: vi.fn(),
  responseOnRejected: undefined as
    | ((err: unknown) => Promise<unknown>)
    | undefined,
  instance: {
    interceptors: {
      request: { use: () => {} },
      response: {
        use: (
          _onFulfilled: unknown,
          onRejected: (err: unknown) => Promise<unknown>
        ) => {
          mock.responseOnRejected = onRejected;
        },
      },
    },
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => mock.instance,
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp", logout: mock.logout },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { listExperts, listSquads } from "./expertService";
import type { ExpertCatalogSort } from "./expertService";

const SORTS: ExpertCatalogSort[] = [
  "comprehensive",
  "latest",
  "installs",
  "views",
];

function lastListCall(): { url: string; params: Record<string, unknown> } {
  const call = mock.instance.get.mock.calls.at(-1) as [
    string,
    { params: Record<string, unknown> },
  ];
  return { url: call[0], params: call[1].params };
}

describe("expertService catalog sort wire contract", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    mock.instance.get.mockResolvedValue({
      data: { data: [], pagination: { total: 0, page: 1, page_size: 100 } },
    });
  });

  it("listExperts sends every sort mode as the ?sort param", async () => {
    for (const sort of SORTS) {
      await listExperts({ sort });
      const { url, params } = lastListCall();
      expect(url).toBe("/market/api/v1/experts");
      expect(params.sort).toBe(sort);
    }
  });

  it("listSquads sends every sort mode as the ?sort param", async () => {
    for (const sort of SORTS) {
      await listSquads({ sort });
      const { url, params } = lastListCall();
      expect(url).toBe("/market/api/v1/squads");
      expect(params.sort).toBe(sort);
    }
  });

  it("omits sort entirely when the caller does not set one", async () => {
    await listExperts();
    expect(lastListCall().params).not.toHaveProperty("sort");
  });
});
