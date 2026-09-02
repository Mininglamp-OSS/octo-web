import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { t, useI18n, WKApp } from "@octo/base";
import type { ReviewListMode, ReviewRequest, ReviewStatus } from "../types/skill";
import {
  approveReview,
  cancelReview,
  delistPlugin,
  listReviewRequests,
  rejectReview,
} from "../api/skillApi";
import { formatFullDateTime, formatRelativeTime } from "../utils/format";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import { reviewStatusLabel } from "../utils/review";
import MineTable, { type MineAssetType, type MineRow } from "./MineTable";
import DelistReasonModal from "./DelistReasonModal";
import RejectReasonModal from "./RejectReasonModal";
import ReviewDetailDrawer from "./ReviewDetailDrawer";

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

const PAGE_SIZE = 20;
/** The three terminal statuses, fetched explicitly for the 已处理 view so we
 *  never stream pages full of pending rows that get filtered out client-side
 *  (defect 4 in the source branch). Parallel first-page + independent cursors
 *  is simpler than a merged-cursor state machine and avoids the empty-page
 *  cascade. */
type HandledStatus = Exclude<ReviewStatus, "pending">;
const TERMINAL_STATUSES: HandledStatus[] = ["approved", "rejected", "canceled"];

interface HandledPage {
  items: ReviewRequest[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  error: string | null;
}

const emptyHandledPage = (): HandledPage => ({
  items: [],
  nextCursor: null,
  total: 0,
  loading: false,
  error: null,
});

type HandledState = Record<HandledStatus, HandledPage>;

const initialHandled = (): HandledState => ({
  approved: emptyHandledPage(),
  rejected: emptyHandledPage(),
  canceled: emptyHandledPage(),
});

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

  // Pending tab: one fetch, cursor-based pagination.
  const [pendingItems, setPendingItems] = useState<ReviewRequest[]>([]);
  const [pendingCursor, setPendingCursor] = useState<string | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingLoadingMore, setPendingLoadingMore] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const pendingAbortRef = useRef<AbortController | null>(null);

  // Handled tab: three independent per-status lists (defect 4).
  type AbortRefMap = { [K in HandledStatus]: AbortController | null };
  const [handled, setHandled] = useState<HandledState>(initialHandled());
  const handledAbortRefs = useRef<AbortRefMap>({
    approved: null,
    rejected: null,
    canceled: null,
  });
  const [handledLoading, setHandledLoading] = useState(false);
  const [handledLoadingMore, setHandledLoadingMore] = useState(false);

  const currentUid = (WKApp.loginInfo as { uid?: string } | undefined)?.uid;

  // Reset tab on mode change.
  useEffect(() => {
    setActiveTab("pending");
    setError(null);
  }, [mode]);

  // ── Pending fetch ────────────────────────────────────────────────────
  const fetchPending = useCallback(
    async (nextCursor?: string | null) => {
      if (pendingAbortRef.current) pendingAbortRef.current.abort();
      const controller = new AbortController();
      pendingAbortRef.current = controller;
      const isMore = Boolean(nextCursor);
      if (isMore) setPendingLoadingMore(true);
      else setPendingLoading(true);
      setPendingError(null);
      try {
        const page = Number.parseInt(nextCursor ?? "", 10);
        const result = await listReviewRequests(mode, {
          status: "pending",
          page: Number.isFinite(page) && page > 0 ? page : 1,
          pageSize: PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setPendingItems((cur) => (isMore ? [...cur, ...result.items] : result.items));
        setPendingTotal(result.total);
        setPendingCursor(result.nextCursor);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPendingError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
      } finally {
        if (!controller.signal.aborted) {
          setPendingLoading(false);
          setPendingLoadingMore(false);
        }
      }
    },
    [mode],
  );

  const refreshPending = useCallback(() => {
    void fetchPending(null);
  }, [fetchPending]);

  const loadMorePending = useCallback(() => {
    if (!pendingCursor || pendingLoading || pendingLoadingMore) return;
    void fetchPending(pendingCursor);
  }, [fetchPending, pendingCursor, pendingLoading, pendingLoadingMore]);

  // ── Handled fetch (three parallel per-status lists) ──────────────────
  const fetchHandledPage = useCallback(
    async (status: HandledStatus, nextCursor?: string | null, isMore = false) => {
      const prev = handledAbortRefs.current[status];
      if (prev) prev.abort();
      const controller = new AbortController();
      handledAbortRefs.current[status] = controller;
      setHandled((cur) => ({
        ...cur,
        [status]: { ...cur[status], loading: true, error: null },
      }));
      try {
        const page = Number.parseInt(nextCursor ?? "", 10);
        const result = await listReviewRequests(mode, {
          status,
          page: Number.isFinite(page) && page > 0 ? page : 1,
          pageSize: PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setHandled((cur) => {
          const existing = cur[status];
          return {
            ...cur,
            [status]: {
              items: isMore ? [...existing.items, ...result.items] : result.items,
              nextCursor: result.nextCursor,
              total: result.total,
              loading: false,
              error: null,
            },
          };
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHandled((cur) => ({
          ...cur,
          [status]: {
            ...cur[status],
            loading: false,
            error: err instanceof Error ? err.message : t("skillMarket.common.loadFailed"),
          },
        }));
      }
    },
    [mode],
  );

  const refreshHandled = useCallback(() => {
    setHandled({
      approved: emptyHandledPage(),
      rejected: emptyHandledPage(),
      canceled: emptyHandledPage(),
    });
    setHandledLoading(true);
    void Promise.all(TERMINAL_STATUSES.map((s) => fetchHandledPage(s, null, false))).finally(() => {
      setHandledLoading(false);
    });
  }, [fetchHandledPage]);

  const loadMoreHandled = useCallback(() => {
    const anyHasMore = TERMINAL_STATUSES.some((s) => handled[s].nextCursor);
    if (!anyHasMore || handledLoading || handledLoadingMore) return;
    setHandledLoadingMore(true);
    const tasks = TERMINAL_STATUSES
      .filter((s) => handled[s].nextCursor)
      .map((s) => fetchHandledPage(s, handled[s].nextCursor, true));
    void Promise.all(tasks).finally(() => setHandledLoadingMore(false));
  }, [fetchHandledPage, handled, handledLoading, handledLoadingMore]);

  // Initial + tab-switch fetches.
  useEffect(() => {
    void fetchPending(null);
    return () => {
      if (pendingAbortRef.current) pendingAbortRef.current.abort();
    };
  }, [fetchPending]);

  useEffect(() => {
    if (activeTab === "handled") {
      refreshHandled();
    }
    return () => {
      TERMINAL_STATUSES.forEach((s) => handledAbortRefs.current[s]?.abort());
    };
  }, [activeTab, refreshHandled]);

  // Re-read on a Space switch. MarketSidebar's replaceToRoot renders the review
  // page back into the SAME queue slot with the same component type and no key,
  // so React keeps this instance mounted — the fetch effects above key off
  // `mode`/`activeTab`, neither of which changes on a Space switch, so nothing
  // refetches on its own and the queue would keep showing (and acting on) the
  // previous Space's requests. Also drop any open drawer/modal and in-flight
  // acting id, since each names a request id from the Space we are leaving.
  // Subscribe explicitly, exactly as AllAssetsList does for the same reason.
  const refreshAll = useCallback(() => {
    setError(null);
    setDetailId(null);
    setRejectTarget(null);
    setDelistTarget(null);
    setActingId(null);
    refreshPending();
    if (activeTab === "handled") refreshHandled();
  }, [activeTab, refreshHandled, refreshPending]);

  useEffect(() => {
    WKApp.mittBus.on("space-changed", refreshAll);
    return () => WKApp.mittBus.off("space-changed", refreshAll);
  }, [refreshAll]);

  const rows: ReviewRequest[] = useMemo(() => {
    if (activeTab === "pending") return pendingItems;
    const merged: ReviewRequest[] = [];
    for (const s of TERMINAL_STATUSES) merged.push(...handled[s].items);
    // Newest-first across all three buckets (server already orders each bucket
    // by submitted_at desc, but cross-bucket order is interleaved).
    merged.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return merged;
  }, [activeTab, pendingItems, handled]);

  const listLoading = activeTab === "pending" ? pendingLoading : handledLoading;
  const listLoadingMore = activeTab === "pending" ? pendingLoadingMore : handledLoadingMore;
  const listError = activeTab === "pending" ? pendingError : (
    TERMINAL_STATUSES.map((s) => handled[s].error).find(Boolean) ?? null
  );
  const hasMore = activeTab === "pending"
    ? Boolean(pendingCursor)
    : TERMINAL_STATUSES.some((s) => handled[s].nextCursor);

  const loadMoreRows = useCallback(() => {
    if (activeTab === "pending") loadMorePending();
    else loadMoreHandled();
  }, [activeTab, loadMoreHandled, loadMorePending]);

  // Infinite scroll
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && hasMore) {
          loadMoreRows();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMoreRows, hasMore]);

  // ── Actions ──────────────────────────────────────────────────────────
  // Defect 3 fix: keep actingId set until AFTER refresh() settles, so the
  // row stays disabled and a second click cannot race against the in-flight
  // reconcile.
  async function handleApprove(item: ReviewRequest) {
    setActingId(item.id);
    setError(null);
    try {
      await approveReview(item.id);
      await refreshAllAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.actionFailed"));
      await refreshAllAsync();
    } finally {
      // Clear only if this action still owns the slot: a second row starting
      // mid-flight moves actingId to its own id, and an unconditional clear here
      // would re-enable that row while its POST is still in flight.
      setActingId((cur) => (cur === item.id ? null : cur));
    }
  }

  async function handleCancel(item: ReviewRequest) {
    setActingId(item.id);
    setError(null);
    try {
      await cancelReview(item.id);
      await refreshAllAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.cancelFailed"));
      await refreshAllAsync();
    } finally {
      setActingId((cur) => (cur === item.id ? null : cur));
    }
  }

  // refreshAll but returns a promise so callers can await settle. Individual
  // errors are already captured in state by fetchPending/fetchHandledPage, so
  // we don't need Promise.allSettled (the package's TS lib target doesn't ship
  // it); wrap each promise to swallow rejections so Promise.all waits for all.
  function refreshAllAsync(): Promise<void> {
    setError(null);
    const pendingP = fetchPending(null).catch(() => undefined);
    const handledP = activeTab === "handled"
      ? Promise.all(TERMINAL_STATUSES.map((s) => fetchHandledPage(s, null, false).catch(() => undefined)))
          .then(() => undefined)
      : Promise.resolve(undefined);
    return Promise.all([pendingP, handledP]).then(() => undefined);
  }

  function handleIconError(id: string) {
    setIconErrors((cur) => (cur[id] ? cur : { ...cur, [id]: true }));
  }

  return (
    <div className="skill-market-review-queue">
      {error && (
        <div className="skill-market-form__error skill-market-review-queue__error">
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
          {pendingTotal > 0 && activeTab !== "pending" && (
            <span className="skill-market-review-badge">{pendingTotal}</span>
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

      {!listLoading && listError && rows.length === 0 && (
        <div className="skill-market-state is-error">
          <AlertCircle size={28} />
          <strong>{t("skillMarket.common.loadFailed")}</strong>
          <span>{listError}</span>
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
            const acting = actingId === item.id;
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
              onOpen: () => setDetailId(item.id),
              onApprove: showReviewerActions ? () => void handleApprove(item) : undefined,
              approveAria: t("skillMarket.plugin.ariaApprove", { values: { name: item.pluginName } }),
              onReject: showReviewerActions ? () => setRejectTarget(item) : undefined,
              rejectAria: t("skillMarket.plugin.ariaReject", { values: { name: item.pluginName } }),
              onCancelReview: showCancel ? () => void handleCancel(item) : undefined,
              cancelReviewAria: t("skillMarket.plugin.ariaCancelReview", { values: { name: item.pluginName } }),
              onDelist: showDelist ? () => setDelistTarget(item) : undefined,
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
          void refreshAllAsync();
        }}
      />
      <DelistReasonModal
        visible={Boolean(delistTarget)}
        pluginName={delistTarget?.pluginName}
        onClose={() => {
          if (actingId) return;
          setDelistTarget(null);
        }}
        onConfirm={async (reason) => {
          if (!delistTarget) return;
          const id = delistTarget.id;
          setActingId(id);
          setError(null);
          try {
            await delistPlugin({ pluginId: delistTarget.pluginId, reason });
          } catch (err) {
            // Same shape as reject: a 409 here means somebody already took it
            // down, or the author republished under us. Surface it on the queue
            // banner AND inside the modal, then reconcile.
            setError(err instanceof Error ? err.message : t("skillMarket.review.delistFailed"));
            await refreshAllAsync();
            setActingId((cur) => (cur === id ? null : cur));
            throw err;
          }
          await refreshAllAsync();
          setActingId((cur) => (cur === id ? null : cur));
          setDelistTarget(null);
        }}
      />
      <RejectReasonModal
        visible={Boolean(rejectTarget)}
        pluginName={rejectTarget?.pluginName}
        onClose={() => {
          if (actingId) return;
          setRejectTarget(null);
        }}
        onConfirm={async (reason) => {
          if (!rejectTarget) return;
          const id = rejectTarget.id;
          setActingId(id);
          setError(null);
          try {
            await rejectReview(id, reason);
          } catch (err) {
            // Defect 2 fix: surface wire errors (e.g. 409 another admin
            // already decided) — queue-level banner + modal inline error
            // (the modal's own catch sets its error state when we throw).
            setError(err instanceof Error ? err.message : t("skillMarket.review.actionFailed"));
            await refreshAllAsync();
            setActingId((cur) => (cur === id ? null : cur));
            throw err; // let RejectReasonModal display its own inline error
          }
          // Success path: keep actingId set until refresh settles so the
          // row stays disabled (defect 3).
          await refreshAllAsync();
          setActingId((cur) => (cur === id ? null : cur));
          setRejectTarget(null);
        }}
      />
    </div>
  );
}
