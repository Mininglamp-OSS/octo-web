import { t } from "@octo/base";
import type { ReviewKind, ReviewRequest, ReviewStatus } from "../types/skill";

const PLUGIN_TYPE_LABEL_KEYS: Record<string, string> = {
  skill: "skillMarket.review.pluginTypeSkill",
  connector: "skillMarket.review.pluginTypeConnector",
  expert: "skillMarket.review.pluginTypeExpert",
  expert_team: "skillMarket.review.pluginTypeExpertTeam",
};

/** Review covers every plugin type, not just skills, so the queue has to be
 *  able to label a connector/expert row even though this package's catalog is
 *  skill-only. Unknown types fall back to the raw wire value rather than an
 *  empty cell. */
export function pluginTypeLabel(pluginType: string): string {
  const key = PLUGIN_TYPE_LABEL_KEYS[pluginType];
  return key ? t(key) : pluginType;
}

export function reviewStatusLabel(status: ReviewStatus): string {
  switch (status) {
    case "pending":
      return t("skillMarket.review.statusPending");
    case "approved":
      return t("skillMarket.review.statusApproved");
    case "rejected":
      return t("skillMarket.review.statusRejected");
    case "canceled":
      return t("skillMarket.review.statusCanceled");
    default:
      return status;
  }
}

export function reviewKindLabel(kind: ReviewKind): string {
  return kind === "upgrade"
    ? t("skillMarket.review.kindUpgrade")
    : t("skillMarket.review.kindFirst");
}

export interface SkillReviewState {
  /** The open request blocking further submissions, if any. */
  pending?: ReviewRequest;
  /** The most recent rejection, surfaced only while nothing is pending. */
  rejected?: ReviewRequest;
}

/**
 * Join the caller's own review requests onto their plugins by `pluginId`.
 *
 * Review state is NOT a column on the plugin — a listed v1 and an in-review v2
 * coexist server-side — so the "我的插件" card badges are derived here at render
 * time from a `mode=mine` request list. `requests` is expected newest-first
 * (the server orders by `submitted_at` descending), so the first match per
 * plugin wins.
 */
export function deriveSkillReviewState(
  requests: ReviewRequest[]
): Map<string, SkillReviewState> {
  const byPlugin = new Map<string, SkillReviewState>();
  for (const request of requests) {
    const entry = byPlugin.get(request.pluginId) ?? {};
    if (request.status === "pending") {
      if (!entry.pending) entry.pending = request;
    } else if (request.status === "rejected") {
      if (!entry.rejected) entry.rejected = request;
    }
    byPlugin.set(request.pluginId, entry);
  }
  // A pending resubmission supersedes an older rejection: the card must not
  // show "已拒绝" while a new attempt is in the queue.
  for (const entry of byPlugin.values()) {
    if (entry.pending) delete entry.rejected;
  }
  return byPlugin;
}
