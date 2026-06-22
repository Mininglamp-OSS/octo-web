import { beforeEach, describe, expect, it } from "vitest";
import {
  isAuthExpiredApiError,
  isForbiddenApiError,
  isInternalApiError,
  isRateLimitedApiError,
  normalizeApiError,
} from "../apiError";
import { i18n } from "../../i18n/instance";

describe("normalizeApiError", () => {
  beforeEach(() => {
    i18n.setLocale("zh-CN", { notify: false, persist: false });
  });

  it("uses v2 error.http_status as semantic status and shows localized business message", () => {
    const raw = new Error("axios wrapper");
    const normalized = normalizeApiError({
      httpStatus: 400,
      raw,
      data: {
        error: {
          code: "err.matter.title_required",
          message: "标题不能为空",
          details: { field: "title" },
          http_status: 422,
        },
        msg: "legacy fallback",
        status: 400,
      },
    });

    expect(normalized).toEqual({
      code: "err.matter.title_required",
      httpStatus: 422,
      message: "标题不能为空",
      backendMessage: "标题不能为空",
      details: { field: "title" },
      raw,
    });
  });

  it("maps v2 auth codes to the local session-expired message", () => {
    const normalized = normalizeApiError({
      httpStatus: 400,
      data: {
        error: {
          code: "err.shared.auth.token_expired",
          message: "backend login required",
          http_status: 401,
        },
      },
    });

    expect(normalized.httpStatus).toBe(401);
    expect(normalized.message).toBe("登录已过期，请重新登录");
    expect(normalized.backendMessage).toBe("backend login required");
    expect(isAuthExpiredApiError(normalized)).toBe(true);
    expect(isForbiddenApiError(normalized)).toBe(false);
  });

  it("hides backend text for err.shared.internal", () => {
    const normalized = normalizeApiError({
      httpStatus: 400,
      data: {
        error: {
          code: "err.shared.internal",
          message: "sql: secret stack trace",
          http_status: 500,
        },
      },
    });

    expect(normalized.message).toBe("未知错误");
    expect(normalized.backendMessage).toBeUndefined();
    expect(isInternalApiError(normalized)).toBe(true);
  });

  it("treats any 5xx as internal even for legacy envelopes", () => {
    const normalized = normalizeApiError({
      httpStatus: 500,
      data: {
        msg: "database password leaked",
        status: 500,
      },
    });

    expect(normalized.message).toBe("未知错误");
    expect(normalized.backendMessage).toBeUndefined();
    expect(isInternalApiError(normalized)).toBe(true);
  });

  it("keeps forbidden separate from auth-expired logout semantics", () => {
    const normalized = normalizeApiError({
      httpStatus: 400,
      data: {
        error: {
          code: "err.shared.auth.forbidden",
          message: "没有权限",
          http_status: 403,
        },
      },
    });

    expect(normalized.message).toBe("没有权限");
    expect(isForbiddenApiError(normalized)).toBe(true);
    expect(isAuthExpiredApiError(normalized)).toBe(false);
  });

  it("uses local fallback copy for bare 403 and 429 statuses", () => {
    expect(normalizeApiError({ httpStatus: 403, data: {} }).message).toBe("没有权限");
    expect(normalizeApiError({ httpStatus: 429, data: {} }).message).toBe("请求过于频繁，请稍后再试");
  });

  it("recognizes rate limit errors and keeps safe backend message", () => {
    const normalized = normalizeApiError({
      httpStatus: 429,
      data: {
        error: {
          code: "err.shared.rate.limited",
          message: "请求过于频繁，请稍后再试",
          http_status: 429,
        },
      },
    });

    expect(normalized.message).toBe("请求过于频繁，请稍后再试");
    expect(isRateLimitedApiError(normalized)).toBe(true);
  });

  it("uses legacy msg and status when v2 envelope is absent", () => {
    const normalized = normalizeApiError({
      httpStatus: 400,
      data: {
        msg: "不支持的文件类型",
        status: "400",
      },
    });

    expect(normalized).toMatchObject({
      httpStatus: 400,
      message: "不支持的文件类型",
      backendMessage: "不支持的文件类型",
    });
  });

  it("falls back to local not-found and unknown messages", () => {
    expect(normalizeApiError({ httpStatus: 404, data: {} }).message).toBe("请求地址没有找到（404）");
    expect(normalizeApiError({ httpStatus: 418, data: {} }).message).toBe("未知错误");
  });

  // YUJ-2628 — 无响应错误（请求超时/网络中断）必须归类成可读提示，
  // 否则登录页 hang 住后用户只看到「未知错误」。
  it("classifies axios timeout (ECONNABORTED) as timeout message", () => {
    const raw: any = new Error("timeout of 20000ms exceeded");
    raw.code = "ECONNABORTED";
    expect(normalizeApiError({ raw }).message).toBe("请求超时，请检查网络后重试");
  });

  it("classifies timeout by message even without code", () => {
    const raw: any = new Error("timeout exceeded");
    expect(normalizeApiError({ raw }).message).toBe("请求超时，请检查网络后重试");
  });

  it("classifies axios network error (ERR_NETWORK) as network message", () => {
    const raw: any = new Error("Network Error");
    raw.code = "ERR_NETWORK";
    expect(normalizeApiError({ raw }).message).toBe("网络异常，请检查网络后重试");
  });

  it("does not misclassify a normal HTTP error as timeout/network", () => {
    const raw: any = new Error("Request failed with status code 500");
    expect(normalizeApiError({ httpStatus: 500, data: {}, raw }).message).toBe("未知错误");
  });
});
