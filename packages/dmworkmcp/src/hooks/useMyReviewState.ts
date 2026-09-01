import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  deriveSkillReviewState,
  useReviewRequests,
  type MineReviewBadge,
  type ReviewRequest,
  type SkillReviewState,
} from "@dmwork/skillmarket";

/**
 * The caller's own review requests, joined onto their plugins by id.
 *
 * `mode=mine` is applicant-scoped (no reviewer role needed) and covers EVERY
 * plugin type, so the connector / 专家 / 专家团 "我的" surfaces read the same list
 * the skill market does. Review state is never a column on the plugin — a listed
 * v1 and an in-review v2 coexist server-side — so the badge is derived at render
 * time, exactly as SkillListPage does.
 *
 * Held back on the discovery catalog (`enabled: false`): a public card shows no
 * review state and no owner actions, so the read would be pure cost.
 */
export interface UseMyReviewStateResult {
  stateByPlugin: Map<string, SkillReviewState>;
  refresh: () => void;
}

export function useMyReviewState(enabled: boolean): UseMyReviewStateResult {
  const { items, refresh } = useReviewRequests({
    mode: "mine",
    pageSize: 100,
    enabled,
  });
  // Both halves are identity-stabilized: <MyReviewStateProbe /> pushes this
  // object into a class component's state, so a fresh Map or a fresh `refresh`
  // closure on every render would loop (report → setState → render → report).
  // `items` is replaced only by an actual fetch, so keying the memo on it is a
  // genuine "nothing changed" reuse.
  const stateByPlugin = useMemo(() => deriveSkillReviewState(items), [items]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  return useMemo(
    () => ({ stateByPlugin, refresh: stableRefresh }),
    [stableRefresh, stateByPlugin]
  );
}

/**
 * Resolve the row badge + which owner actions apply, from the plugin's
 * visibility and its latest pending / rejected request.
 *
 * The five states are mutually exclusive by construction and the ORDER matters,
 * matching SkillListPage:
 *   - a pending request outranks a stale rejection (never show 已拒绝 while a
 *     resubmission is queued),
 *   - on an already-listed plugin "pending" means the live version stays up
 *     while the new one is reviewed → `pending-upgrade`.
 *
 * `canEdit` is the gate the two market pages hang 编辑 off: a listed plugin
 * changes only through 发布新版本 (a direct edit would take effect immediately for
 * the whole org, routing around review — and the backend answers such a write
 * with 409 `listed_requires_review`), and while a request is pending it does not
 * change at all.
 */
export interface PluginReviewRowState {
  badge: MineReviewBadge;
  pending?: ReviewRequest;
  rejected?: ReviewRequest;
  isPrivate: boolean;
  canEdit: boolean;
  /** First listing of a private draft with nothing in flight. */
  canSubmitReview: boolean;
  /** Already listed to the org, nothing in flight → 发布新版本. */
  canPublishVersion: boolean;
}

export function resolveReviewRowState(
  visibility: string | undefined,
  state: SkillReviewState | undefined
): PluginReviewRowState {
  const pending = state?.pending;
  const rejected = state?.rejected;
  const isPrivate = visibility === "private";
  const badge: MineReviewBadge = pending
    ? isPrivate
      ? "pending"
      : "pending-upgrade"
    : rejected
      ? "rejected"
      : isPrivate
        ? "private"
        : "live";
  return {
    badge,
    pending,
    rejected,
    isPrivate,
    canEdit: isPrivate && !pending,
    canSubmitReview: isPrivate && !pending && !rejected,
    canPublishVersion: !isPrivate && !pending,
  };
}

/**
 * Headless hook adapter for McpMarketListPage, which is a class component (its
 * mittBus wiring, request-version guards and scroll listener all live on the
 * instance). Same pattern MarketSidebar uses for <ReviewGateProbe />: rather
 * than convert the page, mount a child that runs the hook and reports upward.
 * `onChange` must be a stable callback.
 */
export function MyReviewStateProbe({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (result: UseMyReviewStateResult) => void;
}) {
  const result = useMyReviewState(enabled);
  useEffect(() => {
    onChange(result);
  }, [onChange, result]);
  return null;
}
