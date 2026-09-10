import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { t, useI18n, WKApp, WKButton } from "@octo/base";
import type { ReviewListMode, ReviewRequest, ReviewStatus } from "../types/skill";
import {
  approveReview,
  cancelReview,
  delistPlugin,
  rejectReview,
} from "../api/skillApi";
import { formatFullDateTime, formatRelativeTime } from "../utils/format";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import { reviewStatusLabel } from "../utils/review";
import MineTable, { type MineAssetType, type MineRow } from "./MineTable";
import DelistReasonModal from "./DelistReasonModal";
import RejectReasonModal from "./RejectReasonModal";
import ReviewDetailDrawer from "./ReviewDetailDrawer";
import { HANDLED_STATUSES, useReviewQueuePages } from "../hooks/useReviewQueuePages";

type QueueTab = "pending" | "handled";

/** Wire plugin type -> MineTable's local row type. */
const REVIEW_ROW_TYPE: Record<string, MineAssetType> = {
  skill: "skill",
  connector: "connector",
  expert: "expert",
  expert_team: "squad",
};

/**
 * The tone for a review OUTCOME, reusing the status pill's vocabulary.
 *
 * A queue row is a RECORD of a decision, so the status cell says what was
 * decided — not what the plugin happens to be now. Those are different questions
 * and the column previously answered both at once: it took pending/approved/
 * rejected from the request but let a later 下架 overwrite an approval, so a
 * decision appeared to change months after it was made, and two approvals of the
 * same plugin rendered identically. A rejected record, meanwhile, kept saying 驳回
 * even after the author fixed and republished — the same column following live
 * state for one outcome and history for another.
 *
 * The plugin's current listing state is still read, but only to gate 下架: you
 * cannot take down what is not up.
 */
function reviewStatusTone(status: ReviewStatus): string {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "published";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

/**
 * There is deliberately no sibling-refresh callback here.
 *
 * An `onAction?: () => void` used to be invoked at five sites in this component
 * and passed by none of its mounts, so five decision paths announced a decision
 * to nobody — the worst shape a callback can have, because it reads as wired.
 * Refreshing siblings is now the endpoints' job: every review mutation this
 * queue issues is `withReviewInvalidation`-wrapped, so the sidebar badge and any
 * other live `useReviewRequests` re-read on their own (see api/reviewSignal.ts).
 * If a future mount needs to react to a decision, subscribe to that signal
 * rather than threading a prop back through here.
 */
interface ReviewQueueProps {
  /** `space` is the reviewer queue (403 for non-admins server-side); `mine` is
   *  the applicant's own submissions. */
  mode: ReviewListMode;
}

export default function ReviewQueue({ mode }: ReviewQueueProps) {
  useI18n();
  const [activeTab, setActiveTab] = useState<QueueTab>("pending");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ReviewRequest | null>(null);
  const [delistTarget, setDelistTarget] = useState<ReviewRequest | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconErrors, setIconErrors] = useState<Record<string, true>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { pages, refresh, loadMore, retry, reset } = useReviewQueuePages(mode);
  const spaceGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const actionRef = useRef<{ id: string; generation: number; promise: Promise<void> } | null>(null);
  const loadedSpaceRef = useRef(WKApp.shared?.currentSpaceId);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const currentUid = (WKApp.loginInfo as { uid?: string } | undefined)?.uid;

  // Reconciliation never clears a mutation error or closes an open drawer.
  // A drawer callback from an earlier render refreshes the currently active tab.
  const refreshAllAsync = useCallback(() => refresh(
    activeTabRef.current === "handled" ? ["pending", ...HANDLED_STATUSES] : ["pending"]
  ), [refresh]);
  const refreshAllRef = useRef(refreshAllAsync);
  refreshAllRef.current = refreshAllAsync;

  const resetScope = useCallback(() => {
    spaceGenerationRef.current += 1;
    loadedSpaceRef.current = WKApp.shared?.currentSpaceId;
    actionRef.current = null;
    setActingId(null);
    setError(null);
    setDetailId(null);
    setRejectTarget(null);
    setDelistTarget(null);
    setIconErrors({});
    reset();
    void refreshAllAsync();
  }, [reset, refreshAllAsync]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      spaceGenerationRef.current += 1;
      actionRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    activeTabRef.current = "pending";
    setActiveTab("pending");
    resetScope();
  }, [resetScope]);

  useLayoutEffect(() => {
    WKApp.mittBus.on("space-changed", resetScope);
    return () => WKApp.mittBus.off("space-changed", resetScope);
  }, [resetScope]);

  useEffect(() => {
    if (activeTab === "handled" && activeTabRef.current === "handled") void refresh(HANDLED_STATUSES);
  }, [activeTab, refresh]);

  const rows: ReviewRequest[] = useMemo(() => {
    if (activeTab === "pending") return pages.pending.items;
    const merged: ReviewRequest[] = [];
    for (const status of HANDLED_STATUSES) merged.push(...pages[status].items);
    // Newest-first across all three buckets (server already orders each bucket
    // by submitted_at desc, but cross-bucket order is interleaved).
    merged.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return merged;
  }, [activeTab, pages]);

  const visibleStatuses: readonly ReviewStatus[] = activeTab === "pending" ? ["pending"] : HANDLED_STATUSES;
  const listLoading = visibleStatuses.some((status) => pages[status].loading === "initial");
  const listLoadingMore = visibleStatuses.some((status) => pages[status].loading === "more");
  const listError = visibleStatuses.map((status) => pages[status].error).find(Boolean) ?? null;
  const hasMore = visibleStatuses.some((status) => pages[status].nextCursor);

  // A failed page stays paused until explicit retry; never re-observe an
  // intersecting sentinel as a side effect of a rejection or reconciliation.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || listError || listLoading || listLoadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore(activeTab === "pending" ? ["pending"] : HANDLED_STATUSES);
      }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeTab, hasMore, listError, listLoading, listLoadingMore, loadMore]);

  // One synchronous owner covers every row and reason modal through the write
  // AND its reconciliation. Another row cannot replace the first row's lock.
  function runAction(
    item: ReviewRequest,
    operation: () => Promise<unknown>,
    failureKey: string,
    onSuccess?: () => void,
    rethrow = false,
  ): Promise<void> {
    if (!mountedRef.current) return Promise.resolve();
    if (actionRef.current) return rethrow && actionRef.current.id === item.id
      ? actionRef.current.promise : Promise.resolve();
    const spaceId = loadedSpaceRef.current;
    if (spaceId !== WKApp.shared?.currentSpaceId) {
      const changed = new Error(t("skillMarket.review.spaceChanged"));
      setError(changed.message);
      return rethrow ? Promise.reject(changed) : Promise.resolve();
    }
    const owner = { id: item.id, generation: spaceGenerationRef.current, promise: Promise.resolve() };
    const ownsSlot = () => mountedRef.current && actionRef.current === owner;
    const isSession = () => ownsSlot() && owner.generation === spaceGenerationRef.current;
    const isCurrent = () => isSession() && spaceId === WKApp.shared?.currentSpaceId;
    const mayContinue = () => {
      if (isCurrent()) return true;
      const changed = new Error(t("skillMarket.review.spaceChanged"));
      if (isSession()) setError(changed.message);
      // A retained reason must never interpret an abandoned action as success.
      if (rethrow) throw changed;
      return false;
    };
    actionRef.current = owner;
    setActingId(item.id);
    setError(null);
    owner.promise = (async () => {
      try {
        await operation();
        if (!mayContinue()) return;
        await refreshAllAsync();
        if (mayContinue()) onSuccess?.();
      } catch (err) {
        const failure = isSession() && !isCurrent()
          ? new Error(t("skillMarket.review.spaceChanged")) : err;
        if (isSession()) {
          setError(failure instanceof Error ? failure.message : t(failureKey));
          if (isCurrent()) await refreshAllAsync();
        }
        if (isSession() && !isCurrent()) {
          const changed = new Error(t("skillMarket.review.spaceChanged"));
          setError(changed.message);
          if (rethrow) throw changed;
        } else if (rethrow) throw failure;
      } finally {
        // Silent Space changes suppress outcomes, but the operation still owns
        // its lock and must release it. A newer owner can never be unlocked here.
        if (ownsSlot()) {
          actionRef.current = null;
          setActingId(null);
        }
      }
    })();
    return owner.promise;
  }

  function handleApprove(item: ReviewRequest) {
    return runAction(item, () => approveReview(item.id), "skillMarket.review.actionFailed");
  }

  function handleCancel(item: ReviewRequest) {
    return runAction(item, () => cancelReview(item.id), "skillMarket.review.cancelFailed");
  }

  function handleIconError(id: string) {
    setIconErrors((cur) => (cur[id] ? cur : { ...cur, [id]: true }));
  }

  return (
    <div className="skill-market-review-queue">
      {error && (
        <div role="alert" className="skill-market-form__error skill-market-review-queue__error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="skill-market-review-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pending"}
          className={activeTab === "pending" ? "is-active" : ""}
          onClick={() => setActiveTab("pending")}
        >
          {t("skillMarket.review.queuePending")}
          {pages.pending.total > 0 && activeTab !== "pending" && (
            <span className="skill-market-review-badge">{pages.pending.total}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "handled"}
          className={activeTab === "handled" ? "is-active" : ""}
          onClick={() => setActiveTab("handled")}
        >
          {t("skillMarket.review.queueHandled")}
        </button>
      </div>

      {listLoading && rows.length === 0 && (
        <div className="skill-market-review-list--loading">
          <RefreshCw size={16} className="skill-market-spin" />
          {t("skillMarket.common.loading")}
        </div>
      )}

      {listError && (
        <div role="alert" className="skill-market-state is-error">
          <AlertCircle size={28} />
          <strong>{t("skillMarket.common.loadFailed")}</strong>
          <span>{listError}</span>
          <WKButton variant="secondary" disabled={listLoading || listLoadingMore} onClick={() => retry(visibleStatuses)}>
            {t("skillMarket.list.retry")}
          </WKButton>
        </div>
      )}

      {!listLoading && !listError && rows.length === 0 && (
        <div className="skill-market-state">
          {activeTab === "pending" ? (
            <>
              <CheckCircle2 size={48} />
              <strong>
                {mode === "space"
                  ? t("skillMarket.review.emptySpacePending")
                  : t("skillMarket.review.emptyMinePending")}
              </strong>
            </>
          ) : (
            <>
              <Clock size={48} />
              <strong>{t("skillMarket.review.emptyHandled")}</strong>
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <MineTable
          ariaLabel={t("skillMarket.review.orgTab")}
          rows={rows.map((item) => {
            const isApplicant = item.applicantId === currentUid;
            const isPending = item.status === "pending";
            const showReviewerActions = isPending && mode === "space";
            const showCancel = isPending && mode === "mine" && isApplicant;
            const iconErrored = iconErrors[item.id];
            const acting = Boolean(actingId);
            // 下架 is offered on a request whose plugin is still listed. The
            // backend refuses a delist of anything else with 409 not_published,
            // so this only removes a dead affordance — it is not the gate.
            const showDelist =
              mode === "space" && item.status === "approved" && item.pluginListingState === "published";
            return {
              id: item.id,
              type: REVIEW_ROW_TYPE[item.pluginType] ?? "skill",
              trackItemType: item.pluginType,
              icon:
                item.pluginIconUrl && !iconErrored ? (
                  <img
                    className="wk-mine-table__avatar-img"
                    src={item.pluginIconUrl}
                    alt=""
                    onError={() => handleIconError(item.id)}
                  />
                ) : (
                  <span
                    className="wk-mine-table__avatar-tile"
                    style={{ background: getSkillAvatarColor(item.pluginName) }}
                  >
                    {getSkillAvatarText(item.pluginName)}
                  </span>
                ),
              name: item.pluginName,
              // 更新说明 is what a reviewer actually reads to decide, so it takes
              // the 描述 column rather than the plugin's static description.
              description: item.changelog || undefined,
              version: item.version,
              // An upgrade renders `v1.0.0 → v2.0.0`, so the reviewer sees what is
              // being replaced without opening the drawer.
              versionFrom: item.kind === "upgrade" ? item.currentVersion || undefined : undefined,
              // Every request targets organization visibility; that is what a
              // review IS. Rendering it keeps the column meaningful rather than
              // blank on this page.
              visibility: "space",
              statusLabel: reviewStatusLabel(item.status),
              statusTone: reviewStatusTone(item.status),
              rejectReason: item.reason || undefined,
              meta: (
                <>
                  <span>{item.applicantName}</span>
                  <span aria-hidden="true"> · </span>
                  <span title={formatFullDateTime(item.submittedAt)}>
                    {formatRelativeTime(item.submittedAt)}
                  </span>
                </>
              ),
              ariaLabel: item.pluginName,
              busy: acting,
              onOpen: () => {
                if (actionRef.current) return;
                if (loadedSpaceRef.current !== WKApp.shared?.currentSpaceId) setError(t("skillMarket.review.spaceChanged"));
                else setDetailId(item.id);
              },
              onApprove: showReviewerActions ? () => void handleApprove(item) : undefined,
              approveAria: t("skillMarket.plugin.ariaApprove", { values: { name: item.pluginName } }),
              onReject: showReviewerActions ? () => { if (!actionRef.current) setRejectTarget(item); } : undefined,
              rejectAria: t("skillMarket.plugin.ariaReject", { values: { name: item.pluginName } }),
              onCancelReview: showCancel ? () => void handleCancel(item) : undefined,
              cancelReviewAria: t("skillMarket.plugin.ariaCancelReview", { values: { name: item.pluginName } }),
              onDelist: showDelist ? () => { if (!actionRef.current) setDelistTarget(item); } : undefined,
              delistAria: t("skillMarket.plugin.ariaDelist", { values: { name: item.pluginName } }),
            } satisfies MineRow;
          })}
        />
      )}

      <div ref={sentinelRef} className="skill-market-sentinel">
        {listLoadingMore ? (
          <span className="skill-market-sentinel__loading">
            <RefreshCw size={13} />
            {t("skillMarket.list.loadMore")}
          </span>
        ) : null}
      </div>

      <ReviewDetailDrawer
        reviewId={detailId}
        canReview={mode === "space"}
        onClose={() => setDetailId(null)}
        onDecided={() => {
          void refreshAllRef.current();
        }}
      />
      <DelistReasonModal
        key={`delist-${spaceGenerationRef.current}`}
        visible={Boolean(delistTarget)}
        pluginName={delistTarget?.pluginName}
        onClose={() => {
          if (!actionRef.current) setDelistTarget(null);
        }}
        onConfirm={(reason) => delistTarget ? runAction(
          delistTarget,
          () => delistPlugin({ pluginId: delistTarget.pluginId, reason }),
          "skillMarket.review.delistFailed",
          () => setDelistTarget(null),
          true,
        ) : undefined}
      />
      <RejectReasonModal
        key={`reject-${spaceGenerationRef.current}`}
        visible={Boolean(rejectTarget)}
        pluginName={rejectTarget?.pluginName}
        onClose={() => {
          if (!actionRef.current) setRejectTarget(null);
        }}
        onConfirm={(reason) => rejectTarget ? runAction(
          rejectTarget,
          () => rejectReview(rejectTarget.id, reason),
          "skillMarket.review.actionFailed",
          () => setRejectTarget(null),
          true,
        ) : undefined}
      />
    </div>
  );
}
