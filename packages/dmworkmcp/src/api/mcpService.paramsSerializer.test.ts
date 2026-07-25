import { describe, expect, it, vi } from "vitest";

// serializeMcpParams is pure and doesn't call t(), but the file's module
// graph pulls in @octo/base at import-time via other exports. Stub the
// module so the test doesn't depend on i18n / IM SDK bootstrap.
vi.mock("@octo/base", () => ({
  WKApp: { apiClient: { config: {} }, loginInfo: {}, shared: { currentSpaceId: "" }, mittBus: { on: () => {}, off: () => {}, emit: () => {} } },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { serializeMcpParams } from "./mcpService";

describe("serializeMcpParams — axios paramsSerializer wire contract", () => {
  it("emits `?a=1&a=2` for arrays (never `?a[]=1&a[]=2`)", () => {
    // gin's QueryArray on the marketplace backend only recognises the plain
    // repeat form — a revert to axios 0.25's default `?a[]=...` shape would
    // make every multi-tag filter silently return wrong results. Pin.
    expect(serializeMcpParams({ tag: ["a", "b"] })).toBe("tag=a&tag=b");
  });

  it("URL-encodes commas inside a value so comma-bearing tags survive", () => {
    expect(serializeMcpParams({ tag: ["v1.0,beta"] })).toBe("tag=v1.0%2Cbeta");
  });

  it("preserves multiple keys and multi-value ordering", () => {
    expect(
      serializeMcpParams({
        q: "hello",
        tag: ["a", "b"],
        mode: "mine",
      })
    ).toBe("q=hello&tag=a&tag=b&mode=mine");
  });

  it("drops null / undefined values entirely", () => {
    expect(
      serializeMcpParams({
        q: undefined,
        limit: null,
        mode: "mine",
      })
    ).toBe("mode=mine");
  });

  it("drops null / undefined inside arrays (keeps a stable position for the rest)", () => {
    expect(
      serializeMcpParams({
        tag: ["a", undefined as unknown as string, "b", null as unknown as string, "c"],
      })
    ).toBe("tag=a&tag=b&tag=c");
  });

  it("handles empty / undefined params argument", () => {
    expect(serializeMcpParams(undefined)).toBe("");
    expect(serializeMcpParams({})).toBe("");
    expect(serializeMcpParams({ tag: [] })).toBe("");
  });

  it("stringifies non-string primitives (limit, offset)", () => {
    expect(serializeMcpParams({ limit: 50, offset: 0 })).toBe("limit=50&offset=0");
  });
});
