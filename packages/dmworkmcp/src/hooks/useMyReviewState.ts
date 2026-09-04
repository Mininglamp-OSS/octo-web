import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  deriveSkillReviewState,
  useReviewRequests,
  type PluginDisplayStatus,
  type ReviewRequest,
  type SkillReviewState,
} from "@dmwork/skillmarket";

/**
 * The caller's own review requests, kept ONLY for the text a plugin row cannot
 * carry: the rejection reason.
 *
 * This used to compute the row's whole state by joining the request list onto
 * the plugin list and re-deriving a five-value badge. That derivation now lives
 * on the server as `display_status`, because three pages each reimplemented the
 * precedence and disagreed about a listed plugin with a pending upgrade. What
 * survives here is the lookup for `reason`, which is a property of the REQUEST
 * and has nowhere else to live.
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
 * Which owner actions apply to a row, given the SERVER's status.
 *
 * Nothing here re-derives the status; it only translates it into affordances,
 * mirroring rules the backend enforces anyway:
 *
 *   - 编辑 is withheld from a plugin LISTED TO THE ORG, because a direct edit
 *     would take effect immediately for everyone and route around review. The
 *     backend answers such a write with 409 `listed_requires_review`. A PRIVATE
 *     plugin — published or not — has no org audience to protect and stays
 *     editable, and a draft / rejected / delisted row is editable by definition:
 *     that is how you fix it and publish again.
 *   - Nothing is editable while a request is pending, so the frozen snapshot the
 *     reviewer is looking at keeps matching what the author last said.
 *   - 升级版本 is the only content path left on a listed plugin, and 取消审核 the
 *     only one on a pending row. There is no longer a 提交审核 action: publishing
 *     is one button whose meaning the backend decides from the visibility.
 */
export interface PluginReviewRowState {
  status: PluginDisplayStatus;
  pending?: ReviewRequest;
  rejected?: ReviewRequest;
  /** Rejection text for the status tooltip; undefined unless status is rejected. */
  rejectReason?: string;
  canEdit: boolean;
  /** Listed to the org, nothing in flight → 升级版本. */
  canUpgrade: boolean;
  /** A request is open → 取消审核. */
  canCancelReview: boolean;
  /** Unlisted (draft / rejected / delisted) and nothing in flight → 发布. */
  canPublish: boolean;
}

export function resolveReviewRowState(
  visibility: string | undefined,
  listingState: string | undefined,
  displayStatus: PluginDisplayStatus | undefined,
  state: SkillReviewState | undefined
): PluginReviewRowState {
  const status: PluginDisplayStatus = displayStatus ?? "draft";
  const pending = status === "pending_review";
  const listedToOrg = listingState === "published" && visibility === "space";
  return {
    status,
    pending: state?.pending,
    rejected: state?.rejected,
    rejectReason: status === "rejected" ? state?.rejected?.reason : undefined,
    canEdit: !listedToOrg && !pending,
    canUpgrade: listedToOrg && !pending,
    canCancelReview: pending,
    canPublish: listingState !== "published" && !pending,
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
