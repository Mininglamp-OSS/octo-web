import { describe, it, expect, beforeEach, vi } from "vitest";

// Real header-forwarding path for APIClient (XIN-424).
//
// Regression guard for the "explicit X-Space-Id was dead code" bug: the standalone /d/:docId
// preflight passes an explicit `X-Space-Id` header via config.headers, but APIClient.get/post/
// put/delete used to forward only params/baseURL to axios and silently drop config.headers, so
// the header never reached the wire (the seam-level MockApiClient recorded the config and looked
// green while production dropped it). These tests mock the axios module and assert the header
// really lands in the axios call, plus that the request interceptor's merge lets an explicit
// per-request X-Space-Id win over the interceptor's currentSpaceId fallback.

const { getMock, postMock, putMock, patchMock, deleteMock, holder } = vi.hoisted(() => ({
  getMock: vi.fn(() => Promise.resolve({ data: {} })),
  postMock: vi.fn(() => Promise.resolve({ data: {} })),
  putMock: vi.fn(() => Promise.resolve({ data: {} })),
  patchMock: vi.fn(() => Promise.resolve({ data: {} })),
  deleteMock: vi.fn(() => Promise.resolve({ data: {} })),
  holder: { requestInterceptor: null as null | ((config: any) => any) },
}));

vi.mock("axios", () => ({
  default: {
    defaults: {} as Record<string, unknown>,
    interceptors: {
      request: {
        use: vi.fn((fn: (config: any) => any) => {
          holder.requestInterceptor = fn;
        }),
      },
      response: { use: vi.fn() },
    },
    get: getMock,
    post: postMock,
    put: putMock,
    patch: patchMock,
    delete: deleteMock,
  },
}));

import APIClient from "../APIClient";

const client = APIClient.shared;

beforeEach(() => {
  vi.clearAllMocks();
  client.config.spaceIdCallback = undefined;
  client.config.tokenCallback = undefined;
});

describe("APIClient forwards config.headers to axios (explicit X-Space-Id reaches the wire)", () => {
  it("get() forwards config.headers", async () => {
    await client.get("/docs/d1", { headers: { "X-Space-Id": "sp1" } });
    expect(getMock).toHaveBeenCalledWith(
      "/docs/d1",
      expect.objectContaining({ headers: { "X-Space-Id": "sp1" } }),
    );
  });

  it("post() forwards config.headers", async () => {
    await client.post("/docs", { title: "t" }, { headers: { "X-Space-Id": "sp2" } });
    expect(postMock).toHaveBeenCalledWith(
      "/docs",
      { title: "t" },
      expect.objectContaining({ headers: { "X-Space-Id": "sp2" } }),
    );
  });

  it("put() forwards config.headers", async () => {
    await client.put("/docs/d1", { title: "t" }, { headers: { "X-Space-Id": "sp3" } });
    expect(putMock).toHaveBeenCalledWith(
      "/docs/d1",
      { title: "t" },
      expect.objectContaining({ headers: { "X-Space-Id": "sp3" } }),
    );
  });

  it("patch() forwards config.headers", async () => {
    await client.patch("/docs/d1", { title: "t" }, { headers: { "X-Space-Id": "sp4" } });
    expect(patchMock).toHaveBeenCalledWith(
      "/docs/d1",
      { title: "t" },
      expect.objectContaining({ headers: { "X-Space-Id": "sp4" } }),
    );
  });

  it("delete() forwards config.headers", async () => {
    await client.delete("/docs/d1", { headers: { "X-Space-Id": "sp5" } });
    expect(deleteMock).toHaveBeenCalledWith(
      "/docs/d1",
      expect.objectContaining({ headers: { "X-Space-Id": "sp5" } }),
    );
  });

  it("omits headers (undefined) when the caller passes none — unchanged behavior", async () => {
    await client.get("/docs/d1", { param: { a: 1 } });
    const [, cfg] = getMock.mock.calls.at(-1)!;
    expect((cfg as { headers?: unknown }).headers).toBeUndefined();
    expect((cfg as { params?: unknown }).params).toEqual({ a: 1 });
  });
});

describe("request interceptor X-Space-Id merge (explicit header wins, interceptor is fallback)", () => {
  it("does NOT overwrite an explicit per-request X-Space-Id with the interceptor's space", () => {
    client.config.spaceIdCallback = () => "interceptor-space";
    const out = holder.requestInterceptor!({ headers: { "X-Space-Id": "explicit-space" } });
    expect(out.headers["X-Space-Id"]).toBe("explicit-space");
  });

  it("injects the interceptor's space when no explicit header is present (unchanged fallback)", () => {
    client.config.spaceIdCallback = () => "interceptor-space";
    const out = holder.requestInterceptor!({ headers: {} });
    expect(out.headers["X-Space-Id"]).toBe("interceptor-space");
  });

  it("injects nothing when the interceptor space is empty (cold standalone deep link)", () => {
    client.config.spaceIdCallback = () => "";
    const out = holder.requestInterceptor!({ headers: {} });
    expect(out.headers["X-Space-Id"]).toBeUndefined();
  });
});
