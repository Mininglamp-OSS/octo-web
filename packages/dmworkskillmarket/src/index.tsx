export { SkillMarketModule } from "./module";
// Re-exported so dmworkmcp's MarketSidebar can mount the skill list as a
// second tab under the unified "/mcp-market" shell (see MarketSidebar.tsx).
// Keeps the coupling to a single named export instead of dmworkmcp reaching
// into the internal folder tree.
export { default as SkillListPage } from "./pages/SkillListPage";
export {
  default as MineTable,
  type MineRow,
  type MineAssetType,
} from "./components/MineTable";
// "组织审核" — the Space reviewer queue, mounted by dmworkmcp at
// /mcp-market/review as the sidebar's fifth entry.
export { default as SpaceReviewPage } from "./pages/SpaceReviewPage";
// MarketSidebar is a class component and cannot call these itself; it mounts a
// headless probe that does. Exported here (rather than dmworkmcp reaching into
// src/hooks) for the same reason SkillListPage is.
export { useReviewRequests } from "./hooks/useReviewRequests";
export { useSpaceRole, isSpaceReviewerRole } from "./hooks/useSpaceRole";
// The review flow is NOT skill-specific — the connector / 专家 / 专家团 markets in
// dmworkmcp run the same "private draft → 提交审核 → space" lifecycle over the same
// `/plugins/review_requests` endpoints. Rather than let a second package
// re-implement the label vocabulary or the submit/cancel calls, the pieces those
// pages need are re-exported here, next to MineTable which renders them. dmworkmcp funnels every one of these through
// `dmworkmcp/src/api/pluginReview.ts` so the cross-package coupling stays in one
// file on that side too.
export {
  deriveSkillReviewState,
  reviewStatusLabel,
  type SkillReviewState,
} from "./utils/review";
// The single plugin-facing vocabulary: type / visibility / status. Both packages
// render from here so 专家团 and 专家团队 cannot drift apart again.
export {
  pluginTypeLabel,
  visibilityLabel,
  displayStatusLabel,
  displayStatusTone,
} from "./utils/labels";
export {
  createReviewRequest,
  cancelReview,
  // The 发布 / 下架 door is plugin-type agnostic for the same reason review is:
  // the backend decides what publishing MEANS from the plugin's visibility, so a
  // second package must not grow its own copy of that decision.
  publishPlugin,
  delistPlugin,
  pluginConflictReason,
  pluginRequiredRole,
  type CreateReviewRequestInput,
  type DelistPluginInput,
  type PluginConflictReason,
  type PluginListingResult,
  type PublishPluginInput,
  type ReviewRelationInput,
} from "./api/skillApi";
// The 全部 tab of 我的发布 lists every plugin type through the one endpoint that
// can return them together (`mode=mine` with plugin_type omitted), so dmworkmcp
// needs the reader and the row type.
export { getMySkills, deleteSkill } from "./api/skillApi";
// The 全部 tab renders skills beside connectors and experts, so it needs the
// skill avatar helpers to draw a skill row the same way the 技能 tab does.
export { getSkillAvatarColor, getSkillAvatarText } from "./utils/skillAvatar";
export type { Skill } from "./types/skill";
export type {
  ReviewRequest,
  ReviewStatus,
  ReviewKind,
  PluginListingState,
  PluginDisplayStatus,
} from "./types/skill";
