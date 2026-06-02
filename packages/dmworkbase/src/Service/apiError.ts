import { t } from "../i18n/instance";

export interface NormalizeApiErrorInput {
  data?: unknown;
  httpStatus?: number;
  raw?: unknown;
}

export interface NormalizedApiError {
  code?: string;
  httpStatus?: number;
  message: string;
  backendMessage?: string;
  details?: Record<string, unknown>;
  raw: unknown;
}

const authExpiredCodes = new Set([
  "err.shared.auth.required",
  "err.shared.auth.token_missing",
  "err.shared.auth.token_invalid",
  "err.shared.auth.token_expired",
]);

const forbiddenCodes = new Set([
  "err.shared.auth.forbidden",
]);

const rateLimitedCodes = new Set([
  "err.shared.rate.limited",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isV2ErrorEnvelope(data: unknown): data is { error: Record<string, unknown> } {
  return isRecord(data) && isRecord(data.error);
}

function getLegacyStatus(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  return asStatus(data.status);
}

function getLegacyMessage(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  return asNonEmptyString(data.msg);
}

function getDetails(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function isAuthExpiredApiError(error: Pick<NormalizedApiError, "code" | "httpStatus">): boolean {
  return Boolean(error.code && authExpiredCodes.has(error.code)) || error.httpStatus === 401;
}

export function isForbiddenApiError(error: Pick<NormalizedApiError, "code" | "httpStatus">): boolean {
  return Boolean(error.code && forbiddenCodes.has(error.code)) || error.httpStatus === 403;
}

export function isRateLimitedApiError(error: Pick<NormalizedApiError, "code" | "httpStatus">): boolean {
  return Boolean(error.code && rateLimitedCodes.has(error.code)) || error.httpStatus === 429;
}

export function isInternalApiError(error: Pick<NormalizedApiError, "code" | "httpStatus">): boolean {
  return error.code === "err.shared.internal" || Boolean(error.httpStatus && error.httpStatus >= 500);
}

export function normalizeApiError(input: NormalizeApiErrorInput): NormalizedApiError {
  const data = input.data;
  const raw = input.raw ?? data;

  // 无响应错误（请求超时 / 网络中断）：axios reject 时没有 response，因此
  // data 和 httpStatus 都缺失，错误信息挂在 raw 上（code=ECONNABORTED/
  // ERR_NETWORK，message 含 "timeout"）。必须在这里显式归类，否则会落到最后
  // 的「未知错误」分支 —— 而真正的影响是：登录请求永久挂起 + 这个兜底超时
  // 触发后，用户只看到「未知错误」，不知道是网络问题（YUJ-2628：登录页一直
  // 转圈的根因是 APIClient 此前根本没有超时，请求 hang 住 loginLoading 不复位）。
  if (input.httpStatus === undefined && !isRecord(data)) {
    const rawRecord = isRecord(raw) ? raw : undefined;
    const code = asNonEmptyString(rawRecord?.code);
    const message = asNonEmptyString(rawRecord?.message);
    const isTimeout = code === "ECONNABORTED" || /timeout/i.test(message ?? "");
    const isNetwork = code === "ERR_NETWORK" || /network\s*error/i.test(message ?? "");
    if (isTimeout || isNetwork) {
      return {
        code,
        raw,
        message: isTimeout ? t("base.api.error.timeout") : t("base.api.error.network"),
      };
    }
  }

  if (isV2ErrorEnvelope(data)) {
    const envelope = data.error;
    const code = asNonEmptyString(envelope.code);
    const httpStatus = asStatus(envelope.http_status) ?? input.httpStatus;
    const backendMessage = asNonEmptyString(envelope.message);
    const details = getDetails(envelope.details);
    const base = { code, httpStatus, details, raw };

    if (isInternalApiError(base)) {
      return {
        ...base,
        message: t("base.api.error.unknown"),
      };
    }

    if (isAuthExpiredApiError(base)) {
      return {
        ...base,
        message: t("base.api.error.sessionExpired"),
        backendMessage,
      };
    }

    if (isForbiddenApiError(base)) {
      return {
        ...base,
        message: backendMessage || t("base.api.error.forbidden"),
        backendMessage,
      };
    }

    if (isRateLimitedApiError(base)) {
      return {
        ...base,
        message: backendMessage || t("base.api.error.rateLimited"),
        backendMessage,
      };
    }

    return {
      ...base,
      message: backendMessage || t("base.api.error.unknown"),
      backendMessage,
    };
  }

  const httpStatus = getLegacyStatus(data) ?? input.httpStatus;
  const legacyMessage = getLegacyMessage(data);
  const base = { httpStatus, raw };

  if (isInternalApiError(base)) {
    return {
      ...base,
      message: t("base.api.error.unknown"),
    };
  }

  if (isAuthExpiredApiError(base)) {
    return {
      ...base,
      message: legacyMessage || t("base.api.error.sessionExpired"),
      backendMessage: legacyMessage,
    };
  }

  if (isForbiddenApiError(base)) {
    return {
      ...base,
      message: legacyMessage || t("base.api.error.forbidden"),
      backendMessage: legacyMessage,
    };
  }

  if (isRateLimitedApiError(base)) {
    return {
      ...base,
      message: legacyMessage || t("base.api.error.rateLimited"),
      backendMessage: legacyMessage,
    };
  }

  if (httpStatus === 404) {
    return {
      ...base,
      message: legacyMessage || t("base.api.error.notFound"),
      backendMessage: legacyMessage,
    };
  }

  return {
    ...base,
    message: legacyMessage || t("base.api.error.unknown"),
    backendMessage: legacyMessage,
  };
}
