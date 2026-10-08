import { t } from "@octo/base";

type Translate = (
  key: string,
  options?: { values?: Record<string, string | number> }
) => string;

interface SkillUploadErrorMessageOptions {
  fallbackKey?: string;
}

const UPLOAD_ERROR_KEYS: Record<string, string> = {
  DUPLICATE_NAME: "skillMarket.errors.duplicateName",
  INVALID_ZIP: "skillMarket.errors.invalidZip",
  FILE_TOO_LARGE: "skillMarket.errors.fileTooLarge",
  SKILL_MD_TOO_LARGE: "skillMarket.errors.skillMdTooLarge",
  SKILL_MD_NOT_FOUND: "skillMarket.errors.skillMdNotFound",
  MULTIPLE_SKILL_MD: "skillMarket.errors.multipleSkillMd",
  TOO_MANY_FILES: "skillMarket.errors.tooManyFiles",
  DUPLICATE_ENTRY: "skillMarket.errors.duplicateArchiveEntry",
  ZIP_SLIP_DETECTED: "skillMarket.errors.unsafeArchivePath",
  INVALID_SKILL_MD: "skillMarket.errors.invalidSkillMd",
  SKILL_NAME_MISMATCH: "skillMarket.errors.skillNameMismatch",
  PARSE_RETRY_EXHAUSTED: "skillMarket.errors.parseRetryExhausted",
  PARSE_QUEUE_FULL: "skillMarket.errors.parseQueueFull",
  INTERNAL_ERROR: "skillMarket.errors.parseServiceUnavailable",
  parse_timeout: "skillMarket.errors.parseTimeout",
  file_too_large: "skillMarket.errors.fileTooLarge",
  unauthorized: "skillMarket.errors.unauthorized",
  network_error: "skillMarket.errors.network",
  upload_failed: "skillMarket.upload.uploadFailed",
  upload_aborted: "skillMarket.errors.uploadAborted",
  invalid_upload_url: "skillMarket.errors.invalidUrl",
  upload_url_scheme_not_allowed: "skillMarket.errors.urlSchemeNotAllowed",
  invalid_upload_response: "skillMarket.errors.uploadResponseMissing",

  // Compatibility with parse-code shapes returned by older deployments and
  // retained in frontend fixtures. Product copy must depend on the code, never
  // on the backend's English message.
  "err.marketplace.parse.invalid_zip": "skillMarket.errors.invalidZip",
  "parse.no_skill_md": "skillMarket.errors.skillMdNotFound",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSkillUploadErrorKey(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = nonEmptyString(error.code);
  return code && Object.prototype.hasOwnProperty.call(UPLOAD_ERROR_KEYS, code)
    ? UPLOAD_ERROR_KEYS[code]
    : undefined;
}

/**
 * Return safe, localized copy for the Skill upload/parse pipeline.
 *
 * Backend messages are intentionally never used as a display fallback: they
 * are server-owned diagnostics and may be English even in a Chinese UI. The
 * stable error code selects known copy; unknown failures use a local generic
 * message and include the response request id when one was preserved.
 */
export function skillUploadErrorMessage(
  error: unknown,
  options: SkillUploadErrorMessageOptions = {},
  translate: Translate = t
): string {
  const requestId = isRecord(error)
    ? nonEmptyString(error.requestId)
    : undefined;
  let key = resolveSkillUploadErrorKey(error);
  if (
    key === "skillMarket.errors.parseServiceUnavailable" &&
    options.fallbackKey &&
    options.fallbackKey !== "skillMarket.errors.parseFailed"
  ) {
    key = undefined;
  }
  if (key) {
    const message = translate(key);
    return requestId
      ? translate("skillMarket.errors.withRequestId", {
          values: { message, requestId },
        })
      : message;
  }

  if (requestId && !options.fallbackKey) {
    return translate("skillMarket.errors.parseFailedWithRequestId", {
      values: { requestId },
    });
  }
  const fallbackMessage = translate(
    options.fallbackKey ?? "skillMarket.errors.parseFailed"
  );
  return requestId
    ? translate("skillMarket.errors.withRequestId", {
        values: { message: fallbackMessage, requestId },
      })
    : fallbackMessage;
}
