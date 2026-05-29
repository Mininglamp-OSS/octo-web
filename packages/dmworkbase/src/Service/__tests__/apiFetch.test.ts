import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchJson, isApiFetchError } from "../apiFetch";
import { i18n } from "../../i18n/instance";

describe("apiFetch", () => {
  beforeEach(() => {
    i18n.setLocale("zh-CN", { notify: false, persist: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds Accept-Language and preserves caller headers", async () => {
    let capturedHeaders: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input, init?: RequestInit) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await apiFetch("/v1/ping", {
      headers: {
        token: "tkn",
        "Content-Type": "application/json",
      },
    });

    expect(capturedHeaders?.get("Accept-Language")).toBe("zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7");
    expect(capturedHeaders?.get("token")).toBe("tkn");
    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders?.get("X-Octo-Lang")).toBeNull();
    expect(capturedHeaders?.get("X-Octo-Error-Envelope")).toBeNull();
  });

  it("updates Accept-Language from current locale", async () => {
    let capturedHeaders: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input, init?: RequestInit) => {
      capturedHeaders = init?.headers as Headers;
      return new Response("{}", { status: 200 });
    }));

    i18n.setLocale("en-US", { notify: false, persist: false });
    await apiFetch("/v1/ping");

    expect(capturedHeaders?.get("Accept-Language")).toBe("en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7");
  });

  it("parses json success responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ version: "1.0.0" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(apiFetchJson<{ version: string }>("/common/updater/web/1.0")).resolves.toEqual({
      version: "1.0.0",
    });
  });

  it("throws normalized v2 errors using error.http_status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "err.shared.auth.token_expired",
        message: "backend login",
        http_status: 401,
      },
      status: 400,
      msg: "legacy",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })));

    try {
      await apiFetchJson("/private");
      expect.fail("apiFetchJson should reject");
    } catch (error) {
      expect(isApiFetchError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "err.shared.auth.token_expired",
        httpStatus: 401,
        message: "登录已过期，请重新登录",
        backendMessage: "backend login",
      });
    }
  });

  it("keeps legacy messages and hides internal 5xx text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ msg: "bad request", status: 400 }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("secret stack", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/legacy")).rejects.toMatchObject({
      httpStatus: 400,
      message: "bad request",
      backendMessage: "bad request",
    });
    await expect(apiFetch("/boom")).rejects.toMatchObject({
      httpStatus: 500,
      message: "未知错误",
      backendMessage: undefined,
    });
  });
});
