/** Normalize the backend's open dependency-reason vocabulary for display. */
export type DependencyIssueReasonKey =
  | "deleted"
  | "delisted"
  | "release_missing"
  | "unknown";

export function dependencyIssueReasonKey(reason: string | undefined): DependencyIssueReasonKey {
  if (reason === "deleted" || reason === "delisted" || reason === "release_missing") {
    return reason;
  }
  // Older backend/PR wording for a pinned release that is no longer available.
  if (reason === "version_unpublished") return "release_missing";
  return "unknown";
}
