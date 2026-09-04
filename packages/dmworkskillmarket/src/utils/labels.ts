import { t } from "@octo/base";
import type { PluginTypeWire } from "../api/pluginWire";
import type { PluginDisplayStatus, Visibility } from "../types/skill";

/**
 * The one place plugin-facing enums become user-facing text.
 *
 * Before this module the same three vocabularies were spelled out in two i18n
 * namespaces and several private helpers, which is how 专家团 and 专家团队 ended up
 * naming the same type, 待审核 and 审核中 the same state, and 已上架 / 已通过 / 已发布
 * the same outcome. `MineTable` even took a `visibilityLabel` prop whose only
 * reason to exist was that the two packages had separate copies of the strings.
 *
 * Anything that renders a plugin type, visibility or status goes through here.
 * Unknown values fall back to the raw wire value rather than an empty cell, so a
 * server-side enum addition degrades to something debuggable instead of a blank.
 */

const PLUGIN_TYPE_KEYS: Record<string, string> = {
  skill: "skillMarket.plugin.typeSkill",
  connector: "skillMarket.plugin.typeConnector",
  expert: "skillMarket.plugin.typeExpert",
  expert_team: "skillMarket.plugin.typeExpertTeam",
};

export function pluginTypeLabel(pluginType: PluginTypeWire | string): string {
  const key = PLUGIN_TYPE_KEYS[pluginType];
  return key ? t(key) : String(pluginType);
}

const VISIBILITY_KEYS: Record<string, string> = {
  private: "skillMarket.plugin.visibilityPrivate",
  space: "skillMarket.plugin.visibilitySpace",
  system: "skillMarket.plugin.visibilitySystem",
  // `public` is retired on the write path and survives only on legacy rows; it
  // reaches the same audience as `system`, so it reads the same.
  public: "skillMarket.plugin.visibilitySystem",
};

export function visibilityLabel(visibility: Visibility | string): string {
  const key = VISIBILITY_KEYS[visibility];
  return key ? t(key) : String(visibility);
}

const DISPLAY_STATUS_KEYS: Record<string, string> = {
  draft: "skillMarket.plugin.statusDraft",
  pending_review: "skillMarket.plugin.statusPendingReview",
  published: "skillMarket.plugin.statusPublished",
  rejected: "skillMarket.plugin.statusRejected",
  delisted: "skillMarket.plugin.statusDelisted",
};

/**
 * `display_status` is computed by the backend from the listing state plus the
 * review entity, so the client renders it rather than deriving it. Deriving it
 * here again is what the old five-value `MineReviewBadge` union did, and every
 * page got the precedence subtly different.
 */
export function displayStatusLabel(status: PluginDisplayStatus | string): string {
  const key = DISPLAY_STATUS_KEYS[status];
  return key ? t(key) : String(status);
}

/** CSS modifier suffix for a status pill, e.g. `wk-plugin-status--published`. */
export function displayStatusTone(status: PluginDisplayStatus | string): string {
  switch (status) {
    case "published":
      return "published";
    case "pending_review":
      return "pending";
    case "rejected":
      return "rejected";
    case "delisted":
      return "delisted";
    default:
      return "draft";
  }
}
