import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { Toast } from "@douyinfe/semi-ui";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import {
  MineTable,
  cancelReview,
  deleteSkill,
  getMySkills,
  getSkillAvatarColor,
  getSkillAvatarText,
  publishPlugin,
  type MineAssetType,
  type MineActionRequest,
  type MineRow,
  type Skill,
} from "@dmwork/skillmarket";
import { getMcpAvatarColor, getMcpAvatarText } from "../utils/mcpAvatar";

const PAGE_SIZE = 50;

/** Observe the tail until the current cursor loads, then re-arm for the next
 * cursor so a short appended page that remains in view still advances. */
function LoadMoreSentinel({
  onLoadMore,
  rearmKey,
  children,
}: {
  onLoadMore: () => void;
  rearmKey: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore, rearmKey]);

  return (
    <div ref={ref} className="wk-mcp-mine__all-sentinel">
      {children}
    </div>
  );
}

/** Wire plugin type -> MineTable's local row type. */
const ROW_TYPE: Record<string, MineAssetType> = {
  skill: "skill",
  connector: "connector",
  expert: "expert",
  expert_team: "squad",
};

/**
 * The 全部 tab of 我的发布: every plugin the caller owns, of every type, in one
 * table.
 *
 * It exists because the per-type tabs answer "what skills do I have" but nobody
 * could answer "what have I got waiting on review" without visiting four tabs.
 * The backend made this expressible by allowing `plugin_type` to be omitted on
 * the `mode=mine` listing.
 *
 * Type-agnostic actions run here. 详情、编辑 and 升级版本 hand the plugin id to
 * the page-level action host, which opens the owning type's existing modal over
 * this tab; this keeps the mixed table aligned without duplicating authoring UI.
 */
export default function AllAssetsList({
  query = "",
  refreshKey = 0,
  onOpenType,
  onRequestAction,
}: {
  query?: string;
  refreshKey?: number;
  onOpenType: (type: string) => void;
  onRequestAction?: (request: Omit<MineActionRequest, "requestId">) => void;
}) {
  useI18n();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  // Opaque cursor for the next page, null when the list is exhausted. The 全部
  // tab used to fetch a single page and stop, so any owner with more than
  // PAGE_SIZE assets could never see the rest; it now pages like the per-type
  // tabs (SkillListPage / McpMarketListPage), just cursor-driven here.
  const [cursor, setCursor] = useState<string | null>(null);
  // Guards against an out-of-order response overwriting a newer one.
  const requestRef = useRef(0);
  // The IntersectionObserver callback captures these once at observe time, so
  // live request state is read through refs instead.
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(true);
  const moreErrorRef = useRef(false);
  // Records which request generation owns the current pagination request. A
  // stale request must not clear the in-flight guard for a newer Space/load.
  const loadingMoreVersionRef = useRef<number | null>(null);
  const load = useCallback(async () => {
    const version = ++requestRef.current;
    loadingMoreVersionRef.current = null;
    loadingRef.current = true;
    moreErrorRef.current = false;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setMoreError(false);
    try {
      const page = await getMySkills(
        debouncedQuery
          ? { limit: PAGE_SIZE, q: debouncedQuery }
          : { limit: PAGE_SIZE },
        { pluginType: "all" }
      );
      if (version !== requestRef.current) return;
      setItems(page.items);
      const nextCursor = page.items.length > 0 ? page.nextCursor : null;
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    } catch (err) {
      if (version !== requestRef.current) return;
      cursorRef.current = null;
      setCursor(null);
      setError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
    } finally {
      if (version === requestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [debouncedQuery, refreshKey]);

  // Append the next page. Deliberately does NOT bump requestRef — a load-more is
  // a continuation of the current base read, not a new one — but it is voided by
  // any base read or Space switch that bumps the version out from under it. A
  // failed page leaves the existing rows in place and exposes an explicit retry.
  const loadMore = useCallback(async () => {
    const next = cursorRef.current;
    const version = requestRef.current;
    if (
      !next ||
      loadingRef.current ||
      loadingMoreVersionRef.current === version
    )
      return;
    loadingMoreVersionRef.current = version;
    moreErrorRef.current = false;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await getMySkills(
        debouncedQuery
          ? { limit: PAGE_SIZE, cursor: next, q: debouncedQuery }
          : { limit: PAGE_SIZE, cursor: next },
        { pluginType: "all" }
      );
      if (version !== requestRef.current) return;
      setItems((prev) => {
        // The API cursor wraps offset pagination, whose pages can overlap when
        // another actor mutates the listing between requests. Keep each asset
        // id once so MineTable never receives duplicate React keys/rows.
        const seen = new Set(prev.map((item) => item.id));
        const added = page.items.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return [...prev, ...added];
      });
      const nextCursor =
        page.items.length > 0 && page.nextCursor !== next
          ? page.nextCursor
          : null;
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    } catch {
      if (version !== requestRef.current) return;
      moreErrorRef.current = true;
      setMoreError(true);
    } finally {
      if (loadingMoreVersionRef.current !== version) return;
      loadingMoreVersionRef.current = null;
      if (version === requestRef.current) setLoadingMore(false);
    }
  }, [debouncedQuery]);

  const handleLoadMoreIntersection = useCallback(() => {
    // Keep a failed page on explicit retry; repeated observer callbacks must
    // not turn a backend error into an automatic retry loop.
    if (!moreErrorRef.current) void loadMore();
  }, [loadMore]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(
    () => () => {
      requestRef.current += 1;
      loadingMoreVersionRef.current = null;
    },
    []
  );

  // Re-read on a Space switch. Every per-type tab (SkillListPage,
  // McpMarketListPage) subscribes; the 全部 tab — which is the default view and
  // aggregates all four types — otherwise keeps rendering the previous Space's
  // rows with live 发布 / 取消审核 / 删除 bound to old-Space plugin ids. The right
  // pane is only remounted by MarketSidebar for the mcp-market menu, so this tab
  // cannot rely on a remount to reset it.
  useEffect(() => {
    const handleSpaceChanged = () => {
      // Invalidate every load/action continuation before removing identifiers
      // from the Space being left. This also closes a destructive confirmation
      // synchronously instead of leaving it live under the new request header.
      requestRef.current += 1;
      setItems([]);
      cursorRef.current = null;
      setCursor(null);
      setError(null);
      moreErrorRef.current = false;
      setMoreError(false);
      setBusyId(null);
      setDeleting(null);
      void load();
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, [load]);

  /** Runs one row action and reloads when its base read is still current. The
   *  row stays disabled while the mutation is in flight, but a newer list read
   *  must never retain that action's lock. */
  const run = useCallback(
    async (id: string, action: () => Promise<void>, failKey: string) => {
      const version = requestRef.current;
      setBusyId(id);
      try {
        await action();
      } catch (err) {
        if (version !== requestRef.current) return;
        Toast.error(err instanceof Error ? err.message : t(failKey));
      } finally {
        // The row lock belongs to this action, not to the list request
        // generation. A search/refresh can supersede the base read while the
        // mutation is still in flight, but it must not leave the row disabled.
        setBusyId((current) => (current === id ? null : current));
        if (version !== requestRef.current) return;
        const reload = load();
        await reload;
      }
    },
    [load]
  );

  if (loading && items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-review-list--loading">
          <RefreshCw size={16} className="skill-market-spin" />
          {t("skillMarket.common.loading")}
        </div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-state is-error">
          <AlertCircle size={28} />
          <strong>{t("skillMarket.common.loadFailed")}</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-state">
          <PackageOpen size={48} />
          <strong>{t("mcp.mine.emptyAll")}</strong>
        </div>
      </div>
    );
  }

  const rows: MineRow[] = items.map((item) => {
    const wireType = item.pluginType ?? "skill";
    const rowType = ROW_TYPE[wireType] ?? "skill";
    const status = item.displayStatus ?? "draft";
    const pending = status === "pending_review";
    const listedToOrg = item.listingState === "published" && item.visibility === "space";
    return {
      id: item.id,
      type: rowType,
      trackItemType: wireType,
      // Each type draws its avatar the way its OWN tab draws it — skills key the
      // tile off the name, the other markets off the id — so the same row does
      // not change appearance depending on which tab you found it in.
      icon: item.iconUrl ? (
        <img className="wk-mine-table__avatar-img" src={item.iconUrl} alt="" />
      ) : wireType === "skill" ? (
        <span
          className="wk-mine-table__avatar-tile"
          style={{ background: getSkillAvatarColor(item.name) }}
        >
          {getSkillAvatarText(item.name)}
        </span>
      ) : (
        <span
          className="wk-mine-table__avatar-tile"
          style={{ background: getMcpAvatarColor(item.id) }}
        >
          {getMcpAvatarText(item.displayName || item.name)}
        </span>
      ),
      name: item.displayName || item.name,
      description: item.description,
      version: item.version,
      visibility: item.visibility,
      views: item.viewCount,
      // Skills are downloaded as packages and do not report a successful local
      // install. The other plugin types use the backend's install metric, just
      // like their owning tabs do.
      downloads: rowType === "skill" ? item.downloadCount : item.installCount,
      status,
      ariaLabel: item.name,
      busy: busyId === item.id,
      onOpen: onRequestAction
        ? () => onRequestAction({ pluginId: item.id, type: rowType, action: "view" })
        : () => onOpenType(wireType),
      onEdit:
        onRequestAction && !listedToOrg && !pending
          ? () => onRequestAction({ pluginId: item.id, type: rowType, action: "edit" })
          : undefined,
      editAria: t("skillMarket.plugin.ariaEdit", { values: { name: item.name } }),
      onPublish:
        item.listingState !== "published" && !pending
          ? () =>
              void run(
                item.id,
                async () => {
                  // The backend routes on the plugin's declared visibility, so the
                  // toast comes from the response rather than being guessed here.
                  const outcome = await publishPlugin({
                    pluginId: item.id,
                    version: item.version,
                  });
                  Toast.success(
                    outcome.displayStatus === "pending_review"
                      ? t("skillMarket.review.submittedToast")
                      : t("skillMarket.plugin.publishedToast")
                  );
                },
                "skillMarket.review.submitFailed"
              )
          : undefined,
      publishAria: t("skillMarket.plugin.ariaPublish", { values: { name: item.name } }),
      onUpgrade:
        onRequestAction && listedToOrg && !pending
          ? () => onRequestAction({ pluginId: item.id, type: rowType, action: "upgrade" })
          : undefined,
      upgradeAria: t("skillMarket.plugin.ariaUpgrade", { values: { name: item.name } }),
      onCancelReview:
        pending && item.reviewId
          ? () =>
              void run(
                item.id,
                async () => {
                  await cancelReview(item.reviewId as string);
                  Toast.success(t("skillMarket.review.canceledToast"));
                },
                "skillMarket.review.cancelFailed"
              )
          : undefined,
      cancelReviewAria: t("skillMarket.plugin.ariaCancelReview", { values: { name: item.name } }),
      onDelete: () => setDeleting(item),
      deleteAria: t("skillMarket.plugin.ariaDelete", { values: { name: item.name } }),
    };
  });

  return (
    <div className="wk-mcp-mine__all">
      <MineTable rows={rows} ariaLabel={t("mcp.mine.allAriaLabel")} />
      {(cursor || loadingMore || moreError) && (
        <LoadMoreSentinel
          onLoadMore={handleLoadMoreIntersection}
          rearmKey={cursor ?? ""}
        >
          {loadingMore ? (
            <span className="skill-market-review-list--loading">
              <RefreshCw size={14} className="skill-market-spin" />
              {t("skillMarket.common.loading")}
            </span>
          ) : moreError ? (
            <>
              <span role="alert">{t("skillMarket.common.loadFailed")}</span>
              <WKButton variant="secondary" onClick={() => void loadMore()}>
                {t("skillMarket.list.retry")}
              </WKButton>
            </>
          ) : null}
        </LoadMoreSentinel>
      )}
      <WKModal
        visible={Boolean(deleting)}
        onCancel={() => {
          if (!busyId) setDeleting(null);
        }}
        title={t("mcp.mine.deleteTitle")}
        footer={
          <>
            <WKButton
              variant="secondary"
              onClick={() => setDeleting(null)}
              disabled={Boolean(busyId)}
            >
              {t("skillMarket.common.cancel")}
            </WKButton>
            <WKButton
              variant="danger"
              loading={Boolean(busyId)}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                setDeleting(null);
                void run(
                  target.id,
                  async () => {
                    await deleteSkill(target.id);
                    Toast.success(t("mcp.mine.deletedToast"));
                  },
                  "skillMarket.review.actionFailed"
                );
              }}
            >
              {t("skillMarket.plugin.actionDelete")}
            </WKButton>
          </>
        }
      >
        <p>{t("mcp.mine.deleteHint", { values: { name: deleting?.name ?? "" } })}</p>
      </WKModal>
    </div>
  );
}
