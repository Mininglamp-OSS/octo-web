import { t } from "@octo/base";

type Translate = (
  key: string,
  options?: { values?: Record<string, string | number> }
) => string;

export type SkillErrorPhase = "upload" | "parse" | "save" | "create" | "submit";

interface SkillUploadErrorMessageOptions {
  phase?: SkillErrorPhase;
}

const PHASE_FALLBACK_KEYS: Record<SkillErrorPhase, string> = {
  upload: "skillMarket.upload.uploadFailed",
  parse: "skillMarket.errors.parseFailed",
  save: "skillMarket.form.saveFailed",
  create: "skillMarket.form.createFailed",
  submit: "skillMarket.review.submitFailed",
};

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

function errorDetail(error: Record<string, unknown>, key: string): string | undefined {
  return isRecord(error.details) ? nonEmptyString(error.details[key]) : undefined;
}

const CONFLICT_ERROR_KEYS: Record<string, string> = {
  already_published: "skillMarket.errors.alreadyPublished",
  review_pending: "skillMarket.errors.reviewPending",
  not_published: "skillMarket.errors.notPublished",
  label_taken: "skillMarket.errors.versionLabelTaken",
  listed_requires_review: "skillMarket.errors.listedRequiresReview",
  deadlock: "skillMarket.errors.concurrentConflict",
  state: "skillMarket.errors.stateConflict",
};

export function resolveSkillUploadErrorKey(
  error: unknown,
  phase: SkillErrorPhase = "parse"
): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = nonEmptyString(error.code);
  if (!code) return undefined;
  if (code === "INTERNAL_ERROR" && phase !== "parse") return undefined;
  if (Object.prototype.hasOwnProperty.call(UPLOAD_ERROR_KEYS, code)) return UPLOAD_ERROR_KEYS[code];
  if (code === "PAYLOAD_TOO_LARGE") return "skillMarket.errors.fileTooLarge";
  if (code === "DUPLICATE") return "skillMarket.errors.duplicateName";
  if (code === "VALIDATION_ERROR") {
    const field = errorDetail(error, "field");
    const reason = errorDetail(error, "reason");
    if (field === "version" && reason === "must_not_decrease") return "skillMarket.plugin.versionMustNotDecrease";
    if (field === "parse_task_id" && reason === "name_mismatch") return "skillMarket.errors.skillNameMismatch";
    if (field === "parse_task_id" && reason === "invalid_or_consumed") return "skillMarket.errors.parseTaskInvalid";
    if (field === "manifest_json" && reason === "required") return "skillMarket.errors.reviewContentRequired";
    return "skillMarket.errors.validationFailed";
  }
  if (code === "CONFLICT") {
    const reason = errorDetail(error, "conflict_reason");
    return reason && Object.prototype.hasOwnProperty.call(CONFLICT_ERROR_KEYS, reason)
      ? CONFLICT_ERROR_KEYS[reason]
      : "skillMarket.errors.stateConflict";
  }
  if (code === "AUTH_REQUIRED") return "skillMarket.errors.unauthorized";
  if (code === "FORBIDDEN") return "skillMarket.errors.forbidden";
  if (code === "NOT_FOUND") return "skillMarket.errors.notFound";
  if (code === "RATE_LIMITED") return "skillMarket.errors.rateLimited";
  if (code === "UPSTREAM_UNAVAILABLE") return "skillMarket.errors.serviceUnavailable";
  return undefined;
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
  const phase = options.phase ?? "parse";
  const requestId = isRecord(error)
    ? nonEmptyString(error.requestId)
    : undefined;
  const key = resolveSkillUploadErrorKey(error, phase);
  if (key) {
    const message = translate(key);
    return requestId
      ? translate("skillMarket.errors.withRequestId", {
          values: { message, requestId },
        })
      : message;
  }

  if (requestId && phase === "parse") {
    return translate("skillMarket.errors.parseFailedWithRequestId", {
      values: { requestId },
    });
  }
  const fallbackMessage = translate(PHASE_FALLBACK_KEYS[phase]);
  return requestId
    ? translate("skillMarket.errors.withRequestId", {
        values: { message: fallbackMessage, requestId },
      })
    : fallbackMessage;
}
