import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  httpClient,
  request,
  AgentRuntimeError,
  setAuthTokenProvider,
  setUnauthorizedHandler,
  buildAuthHeaders,
} from "../httpClient";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("httpClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock;
    setAuthTokenProvider(() => "secret-token");
    setUnauthorizedHandler(null);
  });
  afterEach(() => {
    setAuthTokenProvider(() => null);
  });

  it("注入 Bearer 鉴权头", () => {
    const h = buildAuthHeaders({ Accept: "application/json" });
    expect(h["Authorization"]).toBe("Bearer secret-token");
    expect(h["Accept"]).toBe("application/json");
  });

  it("解包 {ok:true,data} 返回 data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { id: "s1" } }));
    const out = await httpClient.get<{ id: string }>("/agent/sessions/s1");
    expect(out).toEqual({ id: "s1" });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-token");
  });

  it("{ok:false,error} 抛结构化错误（message + code）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, error: { message: "nope", code: "bad_request" } }, 400),
    );
    await expect(httpClient.get("/x")).rejects.toMatchObject({
      name: "AgentRuntimeError",
      message: "nope",
      code: "bad_request",
      status: 400,
    });
  });

  it("401 抛 AgentRuntimeError 并触发 onUnauthorized", async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 401));
    await expect(httpClient.get("/agent/sessions")).rejects.toBeInstanceOf(AgentRuntimeError);
    expect(onUnauth).toHaveBeenCalledWith("/agent/sessions");
  });

  it("未信封化的 2xx 对象原样返回", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ session_key: "a" }]));
    const out = await httpClient.get<Array<{ session_key: string }>>("/agent/sessions");
    expect(out).toEqual([{ session_key: "a" }]);
  });

  it("query 参数剔除 undefined/null/空串", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    await httpClient.get("/agent/sessions", { agent_id: "a1", limit: undefined, foo: "" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("agent_id=a1");
    expect(url).not.toContain("limit");
    expect(url).not.toContain("foo");
  });

  it("POST 带 body 时注入 Content-Type 并序列化", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: null }, 200));
    await request("/agent/prompt", { method: "POST", body: { prompt: "hi" } });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ prompt: "hi" }));
  });

  it("非 JSON 且非 2xx 抛错", async () => {
    fetchMock.mockResolvedValue(jsonResponse("Internal Error", 500));
    await expect(httpClient.get("/x")).rejects.toMatchObject({ status: 500 });
  });
});
