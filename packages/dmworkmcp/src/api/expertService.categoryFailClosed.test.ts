import { describe, expect, it, vi, beforeEach } from "vitest";

// Same module-load axios mock as expertService.listSort.test.ts — expertService
// builds its own axios instance at import, so we mock the factory and drive
// per-URL responses. This file pins the category fail-CLOSED contract on the
// expert/squad list path (P1-1): an unresolved category filter must return an
// explicit empty result, never widen to the whole catalog like the connector
// path (mcpService.fetchMcpListPath) already guarantees.
const mock = vi.hoisted(() => ({
  instance: {
    interceptors: {
      request: { use: () => undefined },
      response: { use: () => undefined },
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
    apiClient: { config: { apiURL: "/api/v1/" } },
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp" },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { listExperts } from "./expertService";

const CATEGORIES = [
  { category_id: "cat-fin", name: "财务", sort_order: 0, plugin_count: 3 },
];

function listCall() {
  return mock.instance.get.mock.calls.find((c) =>
    (c[0] as string).endsWith("/plugins")
  );
}

describe("expertService list — category fail-closed (P1-1)", () => {
  beforeEach(() => {
    mock.instance.get.mockReset();
    // Distinct space per run so the module-level categoryMapsCache always misses
    // and re-fetches the taxonomy deterministically.
    mock.instance.get.mockImplementation((url: string) => {
      if (url.endsWith("/plugin_categories")) {
        // get<T>() unwraps resp.data.data, so the taxonomy is double-enveloped.
        return Promise.resolve({ data: { data: CATEGORIES } });
      }
      if (url.endsWith("/plugins")) {
        return Promise.resolve({
          data: { data: [], pagination: { total: 0, page: 1, page_size: 100 } },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it("resolves a known category name to its id and issues the list request", async () => {
    await listExperts({ category: "财务" });
    const call = listCall();
    expect(call).toBeTruthy();
    expect((call![1] as { params: Record<string, unknown> }).params.category_id).toBe(
      "cat-fin"
    );
  });

  it("returns an empty result and never issues the list request for an unresolved category", async () => {
    const res = await listExperts({ category: "不存在" });
    // Fail closed: empty, not the whole catalog — and the /plugins request is
    // never sent (we bail after the taxonomy refetch still misses).
    expect(res).toEqual({ items: [], total: 0 });
    expect(listCall()).toBeUndefined();
  });
});
