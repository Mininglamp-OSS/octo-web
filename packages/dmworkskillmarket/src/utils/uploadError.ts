import { t } from "@octo/base";

type Translate = (
  key: string,
  options?: { values?: Record<string, string | number> }
) => string;

const UPLOAD_ERROR_KEYS: Record<string, string> = {
  DUPLICATE_NAME: "skillMarket.errors.duplicateName",
  INVALID_ZIP: "skillMarket.errors.invalidZip",
  FILE_TOO_LARGE: "skillMarket.errors.fileTooLarge",
  SKILL_MD_TOO_LARGE: "skillMarket.errors.skillMdTooLarge",
  SKILL_MD_NOT_FOUND: "skillMarket.errors.skillMdNotFound",
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
  return code ? UPLOAD_ERROR_KEYS[code] : undefined;
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
  translate: Translate = t
): string {
  const key = resolveSkillUploadErrorKey(error);
  if (key) return translate(key);

  const requestId = isRecord(error)
    ? nonEmptyString(error.requestId)
    : undefined;
  return requestId
    ? translate("skillMarket.errors.parseFailedWithRequestId", {
        values: { requestId },
      })
    : translate("skillMarket.errors.parseFailed");
}
