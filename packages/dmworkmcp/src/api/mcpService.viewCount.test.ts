import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  logout: vi.fn(),
  responseRejected: undefined as ((error: unknown) => Promise<never>) | undefined,
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      defaults: {},
      interceptors: {
        request: { use: vi.fn() },
        response: {
          use: vi.fn((_fulfilled, rejected) => {
            mocks.responseRejected = rejected;
          }),
        },
      },
      get: mocks.get,
      post: mocks.post,
      patch: vi.fn(),
      delete: vi.fn(),
    }),
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    apiClient: { config: {} },
    loginInfo: {},
    shared: { currentSpaceId: "space-a", logout: mocks.logout },
    mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { fetchMcpDetail, fetchMcpList, normalizeCount, trackMcpView } from "./mcpService";

describe("MCP view count service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [undefined, 0],
    [null, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [-3, 0],
    [3.9, 3],
    [42, 42],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeCount(input)).toBe(expected);
  });

  it("maps view_count for list and detail responses", async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: {
          data: [{ mcp_id: "m1", name: "MCP", slogan: "", category: "dev", icon: "", tags: [], tool_count: 1, view_count: 7.8 }],
          pagination: { total: 1, page: 1, page_size: 20 },
        },
      })
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({
        data: {
          data: {
            mcp_id: "m1", name: "MCP", slogan: "", category: "dev", icon: "", tags: [], tool_count: 1, view_count: -9,
            quick_start: { transport: "streamable-http", server_name: "MCP" }, tools: [], usage_examples: [], faqs: [], notes: [],
          },
        },
      });

    await expect(fetchMcpList()).resolves.toMatchObject({ items: [{ viewCount: 7 }] });
    await expect(fetchMcpDetail("m1")).resolves.toMatchObject({ viewCount: 0 });
  });

  it("posts the metrics payload and suppresses global logout for its 401", async () => {
    mocks.post.mockResolvedValue({ data: { data: null } });
    await trackMcpView("mcp/1");

    expect(mocks.post).toHaveBeenCalledWith(
      "/market/api/v1/metrics/track",
      { resource_type: "mcp", resource_id: "mcp/1", event_type: "view" },
      { skipGlobalAuthFailure: true }
    );

    await expect(mocks.responseRejected?.({ response: { status: 401 }, config: { skipGlobalAuthFailure: true } })).rejects.toBeTruthy();
    expect(mocks.logout).not.toHaveBeenCalled();
    await expect(mocks.responseRejected?.({ response: { status: 401 }, config: {} })).rejects.toBeTruthy();
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
