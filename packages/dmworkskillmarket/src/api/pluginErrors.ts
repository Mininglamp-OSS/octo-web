import { t } from "@octo/base";

/** Keep HTTP conflicts distinct from actual name reservations. */
export function pluginErrorMessage(code?: string | number, details?: unknown): string {
  const d = details && typeof details === "object" ? details as Record<string, unknown> : {};
  const reason = String(d.conflict_reason ?? d.reason ?? "");
  const reasons: Record<string, string> = {
    name_taken: "nameTaken", state: "stateConflict", deadlock: "stateConflict",
    review_pending: "reviewPending", label_taken: "labelTaken",
    relation_in_use: "relationInUse", dependency_visibility: "dependencyVisibility",
    listed_requires_review: "reviewRequired", version_migration_required: "versionMigration",
  };
  const key = reasons[reason] ?? (code === "DUPLICATE" ? "nameTaken" : code === "CONFLICT" ? "stateConflict" : "");
  return key ? t(`skillMarket.errors.${key}`) : "";
}
