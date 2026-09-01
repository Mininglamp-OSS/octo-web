import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { t, useI18n, WKApp } from "@octo/base";
import type { ReviewListMode, ReviewRequest, ReviewStatus } from "../types/skill";
import { approveReview, cancelReview, listReviewRequests, rejectReview } from "../api/skillApi";
import { formatFullDateTime, formatRelativeTime } from "../utils/format";
import { pluginTypeLabel, reviewKindLabel, reviewStatusLabel } from "../utils/review";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import RejectReasonModal from "./RejectReasonModal";
import ReviewDetailDrawer from "./ReviewDetailDrawer";

type QueueTab = "pending" | "handled";

interface ReviewQueueProps {
  /** `space` is the reviewer queue (403 for non-admins server-side); `mine` is
   *  the applicant's own submissions. */
  mode: ReviewListMode;
  /** Fired after any successful decision so the caller can refresh sibling
   *  views (the plugin grid and the "我的" tab badge). */
  onAction?: () => void;
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

export default function ReviewQueue({ mode, onAction }: ReviewQueueProps) {
  useI18n();
  const [activeTab, setActiveTab] = useState<QueueTab>("pending");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ReviewRequest | null>(null);
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

  const refreshAll = useCallback(() => {
    setError(null);
    refreshPending();
    if (activeTab === "handled") refreshHandled();
  }, [activeTab, refreshHandled, refreshPending]);

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
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.actionFailed"));
      await refreshAllAsync();
    } finally {
      setActingId(null);
    }
  }

  async function handleCancel(item: ReviewRequest) {
    setActingId(item.id);
    setError(null);
    try {
      await cancelReview(item.id);
      await refreshAllAsync();
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.cancelFailed"));
      await refreshAllAsync();
    } finally {
      setActingId(null);
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
        <div className="skill-market-review-list">
          {rows.map((item) => {
            const isApplicant = item.applicantId === currentUid;
            const isPending = item.status === "pending";
            const showReviewerActions = isPending && mode === "space";
            const showCancel = isPending && mode === "mine" && isApplicant;
            const iconErrored = iconErrors[item.id];
            const acting = actingId === item.id;
            return (
              <div
                key={item.id}
                className="skill-market-review-item"
                role="button"
                tabIndex={0}
                onClick={() => !acting && setDetailId(item.id)}
                onKeyDown={(e) => {
                  if (acting) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetailId(item.id);
                  }
                }}
                aria-disabled={acting}
              >
                <div className="skill-market-review-item__icon">
                  {item.pluginIconUrl && !iconErrored ? (
                    <img
                      src={item.pluginIconUrl}
                      alt=""
                      onError={() => handleIconError(item.id)}
                    />
                  ) : (
                    <span style={{ background: getSkillAvatarColor(item.pluginName) }}>
                      {getSkillAvatarText(item.pluginName)}
                    </span>
                  )}
                </div>
                <div className="skill-market-review-item__main">
                  <div className="skill-market-review-item__top">
                    <div className="skill-market-review-item__title-row">
                      <strong title={item.pluginName}>{item.pluginName}</strong>
                      <span className="skill-market-review-item__type">
                        {pluginTypeLabel(item.pluginType)}
                      </span>
                      <span
                        className={`skill-market-review-item__kind skill-market-review-item__kind--${item.kind}`}
                      >
                        {reviewKindLabel(item.kind)}
                      </span>
                      {item.kind === "upgrade" && item.currentVersion ? (
                        <span className="skill-market-review-item__version-bump">
                          {t("skillMarket.review.versionBump", {
                            values: { current: item.currentVersion, next: item.version },
                          })}
                        </span>
                      ) : (
                        <span className="skill-market-review-item__version">v{item.version}</span>
                      )}
                    </div>
                    <div
                      className={`skill-market-review-item__status skill-market-review-item__status--${item.status}`}
                    >
                      {item.status === "pending" && <Clock size={12} />}
                      {item.status === "approved" && <CheckCircle2 size={12} />}
                      {(item.status === "rejected" || item.status === "canceled") && (
                        <XCircle size={12} />
                      )}
                      {reviewStatusLabel(item.status)}
                    </div>
                  </div>
                  <div className="skill-market-review-item__meta">
                    <span>{item.applicantName}</span>
                    <span>·</span>
                    <span title={formatFullDateTime(item.submittedAt)}>
                      {formatRelativeTime(item.submittedAt)}
                    </span>
                  </div>
                  {item.status === "rejected" && item.reason && (
                    <div className="skill-market-review-item__reason">
                      {t("skillMarket.review.reasonInline", { values: { reason: item.reason } })}
                    </div>
                  )}
                  {item.changelog && item.status === "pending" && (
                    <div className="skill-market-review-item__changelog">{item.changelog}</div>
                  )}
                </div>
                <div
                  className="skill-market-review-item__actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {showReviewerActions && (
                    <>
                      <button
                        type="button"
                        className="skill-market-review-item__btn skill-market-review-item__btn--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (acting) return;
                          setRejectTarget(item);
                        }}
                        disabled={acting}
                      >
                        {t("skillMarket.review.reject")}
                      </button>
                      <button
                        type="button"
                        className="skill-market-review-item__btn skill-market-review-item__btn--primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (acting) return;
                          void handleApprove(item);
                        }}
                        disabled={acting}
                      >
                        {acting
                          ? t("skillMarket.review.processing")
                          : t("skillMarket.review.approve")}
                      </button>
                    </>
                  )}
                  {showCancel && (
                    <button
                      type="button"
                      className="skill-market-review-item__btn skill-market-review-item__btn--secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (acting) return;
                        void handleCancel(item);
                      }}
                      disabled={acting}
                    >
                      {acting
                        ? t("skillMarket.review.processing")
                        : t("skillMarket.review.cancelRequest")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
          onAction?.();
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
            setActingId(null);
            throw err; // let RejectReasonModal display its own inline error
          }
          // Success path: keep actingId set until refresh settles so the
          // row stays disabled (defect 3).
          await refreshAllAsync();
          setActingId(null);
          setRejectTarget(null);
          onAction?.();
        }}
      />
    </div>
  );
}
