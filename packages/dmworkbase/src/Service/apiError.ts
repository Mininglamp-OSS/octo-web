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

// Plan F: stale local resource codes. Server emits one such code per cached
// client-side ID it no longer recognizes (e.g., the deviceId UUID in
// localStorage when the server-side device row was removed). Code-only
// matching: server returns HTTP 400 with body.http_status=404 for
// device_not_found, so neither HTTP status nor body http_status is the
// stable contract — the string code is. Future siblings (e.g., space.not_found)
// can be added to this set without touching the interceptor.
const staleLocalResourceCodes = new Set([
  "err.server.user.device_not_found",
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

export function isStaleLocalResourceApiError(error: Pick<NormalizedApiError, "code">): boolean {
  return Boolean(error.code && staleLocalResourceCodes.has(error.code));
}

export function isInternalApiError(error: Pick<NormalizedApiError, "code" | "httpStatus">): boolean {
  return error.code === "err.shared.internal" || Boolean(error.httpStatus && error.httpStatus >= 500);
}

export function normalizeApiError(input: NormalizeApiErrorInput): NormalizedApiError {
  const data = input.data;
  const raw = input.raw ?? data;

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
