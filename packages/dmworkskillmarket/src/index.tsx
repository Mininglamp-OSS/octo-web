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
  type MineReviewBadge,
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
// re-implement the derivation, the submit/cancel calls or the badge union, the
// pieces those pages need are re-exported here, next to MineTable which already
// renders the badge. dmworkmcp funnels every one of these through
// `dmworkmcp/src/api/pluginReview.ts` so the cross-package coupling stays in one
// file on that side too.
export {
  deriveSkillReviewState,
  reviewStatusLabel,
  pluginTypeLabel,
  type SkillReviewState,
} from "./utils/review";
export {
  createReviewRequest,
  cancelReview,
  type CreateReviewRequestInput,
  type ReviewRelationInput,
} from "./api/skillApi";
export type {
  ReviewRequest,
  ReviewStatus,
  ReviewKind,
} from "./types/skill";
