import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronDown,
  PackageOpen,
  RefreshCw,
  Upload,
} from "lucide-react";
import { t, useI18n, WKApp, WKButton, Dap } from "@octo/base";
import type { Skill, SkillSort } from "../types/skill";
import { useSkills } from "../hooks/useSkills";
import { useReviewRequests } from "../hooks/useReviewRequests";
import { cancelReview } from "../api/skillApi";
import { deriveSkillReviewState } from "../utils/review";
import BotPublishModal from "../components/BotPublishModal";
import CategoryChips from "../components/CategoryChips";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import EditSkillModal from "../components/EditSkillModal";
import InstallPromptModal from "../components/InstallPromptModal";
import NewSkillModal from "../components/NewSkillModal";
import SearchBar from "../components/SearchBar";
import SkillCard from "../components/SkillCard";
import SkillCardSkeleton from "../components/SkillCardSkeleton";
import SkillDetailModal from "../components/SkillDetailModal";
import MineTable, { type MineReviewBadge } from "../components/MineTable";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";

/**
 * Rendering variant. "market" (default) = discovery catalog. "mine" = personal
 * assets mounted inside MyAssetsPage — forces the mine data source, hides the
 * in-page tab strip + hero title, and shows manage actions on every card.
 */
interface SkillListPageProps {
  variant?: "market" | "mine";
}

const TOAST_DURATION = 3000;
const SORT_OPTIONS: Array<{ value: SkillSort; labelKey: string; descending?: boolean }> = [
  { value: "latest", labelKey: "skillMarket.sort.latest" },
  { value: "downloads", labelKey: "skillMarket.sort.hottest" },
];

export default function SkillListPage({ variant = "market" }: SkillListPageProps = {}) {
  useI18n();
  // Variant is fixed for the page's lifetime (mine → /mcp-market/mine, market →
  // discovery), so this is a derived constant, not state — the 全部/我的 tab
  // strip that used to flip it was removed in the market UI restructure.
  const mine = variant === "mine";
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SkillSort>("latest");
  const list = useSkills({ mine, selectedTags, sort });
  // Review state for the "我的" surface. `mode=mine` is applicant-scoped (no
  // reviewer role needed), but the public catalog shows no review state at all,
  // so the read is held back to the mine variant to keep discovery cheap.
  const myReviews = useReviewRequests({ mode: "mine", pageSize: 100, enabled: mine });
  const refreshRef = useRef(list.refresh);
  const reviewsRefreshRef = useRef(myReviews.refresh);
  const [createVisible, setCreateVisible] = useState(false);
  // 提交组织审核 / 重新提交 / 发布新版本 all funnel into NewSkillModal's review
  // mode: it collects the version label + changelog and calls
  // `POST /plugins/review_requests`. Content edits go through the separate edit
  // flow first — an owner edit is a mutable draft server-side and never mints a
  // version on its own.
  const [reviewSkill, setReviewSkill] = useState<Skill | null>(null);
  const [reviewInitial, setReviewInitial] = useState<{ version?: string; changelog?: string } | null>(
    null
  );
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [botPublishVisible, setBotPublishVisible] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [installSkillId, setInstallSkillId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const publishMenuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  refreshRef.current = list.refresh;
  reviewsRefreshRef.current = myReviews.refresh;

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleSpaceChanged = () => {
      setPublishMenuOpen(false);
      setCreateVisible(false);
      setReviewSkill(null);
      setReviewInitial(null);
      setBotPublishVisible(false);
      setDetailId(null);
      setEditing(null);
      setDeleting(null);
      setInstallSkillId(null);
      refreshRef.current();
      reviewsRefreshRef.current();
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, []);

  useEffect(() => {
    if (!publishMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (!publishMenuRef.current?.contains(event.target as Node)) {
        setPublishMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPublishMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [publishMenuOpen]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          list.loadMore();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [list]);

  function handleSelectedTagsChange(next: string[]) {
    // 用户增删 tag 过滤;原先误用 GET /plugin_tags 加载 tag 列表推断。
    Dap.shared.track("market_tag_filtered", {});
    setSelectedTags(next);
  }

  function handleSortChange(next: SkillSort) {
    // 八审 P2:原先每个排序项挂无条件 onClick + DOM 委托规则 market_skill_sorted,重复点当前排序也计一次
    //   (选择型控件的过计),且所有项事件相同、区分不出选了哪种排序。改为按「实际变化」gate 后命令式 track,
    //   并带 props.sort 记录排序值。
    if (next === sort) return;
    Dap.shared.track("market_skill_sorted", { sort_by: next });
    setSort(next);
  }

  function handleDeleted() {
    setDetailId(null);
    setEditing(null);
    setDeleting(null);
    showToast(t("skillMarket.list.deleted"));
    list.refresh();
  }

  function handleCreated(message?: string) {
    showToast(message ?? t("skillMarket.list.created"));
    list.refresh();
    // A create can also have submitted a review request; keep the derived row
    // badges in step with it.
    myReviews.refresh();
  }

  function closeCreate() {
    setCreateVisible(false);
    setReviewSkill(null);
    setReviewInitial(null);
  }

  /** Open NewSkillModal in review-submit mode for an already-published skill. */
  function openReviewSubmit(skill: Skill, initialChangelog?: string) {
    setReviewSkill(skill);
    setReviewInitial(initialChangelog ? { changelog: initialChangelog } : null);
    setCreateVisible(true);
  }

  async function handleCancelReview(reviewId: string) {
    try {
      await cancelReview(reviewId);
      showToast(t("skillMarket.review.canceledToast"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("skillMarket.review.cancelFailed"));
    } finally {
      // Refresh either way: on a lost race the server already moved the request
      // out of `pending`, and only a re-read shows the real state.
      list.refresh();
      myReviews.refresh();
    }
  }

  function handleUpdated() {
    showToast(t("skillMarket.list.saved"));
    list.refresh();
    setDetailRefreshKey((current) => current + 1);
  }

  function openDetail(item: Skill) {
    // 六审 C2:卡片打开只保留卡根 data-track="market_card_opened"(DOM 委托,亦覆盖键盘),
    // 删除此处命令式 market_card_viewed —— 二者本是对「同一次打开」的双计(owner 决策:留 opened;与 mcp 侧对称)。
    setDetailId(item.id);
  }

  // Join this user's own review requests onto their rows by plugin id. Review
  // state is never a column on the plugin (a listed v1 and an in-review v2
  // coexist server-side), so it is derived here at render time. Empty on the
  // public catalog — that surface never receives review state or owner actions.
  const reviewStateByPlugin = deriveSkillReviewState(myReviews.items);

  return (
    <div className="skill-market-page">
      <header className="skill-market-topbar">
        {variant !== "mine" && (
          <div className="skill-market-hero-title">
            <h1>{t("skillMarket.list.pageTitle")}</h1>
          </div>
        )}
        <div className="skill-market-topbar__actions">
          <SearchBar
            ref={searchInputRef}
            value={list.query}
            onChange={list.setQuery}
            placeholder={t("skillMarket.filter.searchNameDescription")}
            selectedTags={selectedTags}
            onSelectedTagsChange={handleSelectedTagsChange}
          />
          {variant === "mine" && (
          <div className="skill-market-publish-menu" ref={publishMenuRef}>
            <WKButton
              variant="primary"
              data-testid="skill-publish-entry"
              icon={<Upload size={15} />}
              onClick={() => setPublishMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={publishMenuOpen}
            >
              {t("skillMarket.list.publishSkill")}
              <ChevronDown size={14} />
            </WKButton>
            {publishMenuOpen && (
              <div className="skill-market-publish-menu__panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="skill-publish-method-bot"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    setBotPublishVisible(true);
                  }}
                >
                  <Bot size={16} />
                  <span>
                    <strong>{t("skillMarket.publishMenu.botTitle")}</strong>
                    <small>{t("skillMarket.publishMenu.botHint")}</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="skill-publish-method-manual"
                  onClick={() => {
                    Dap.shared.track("market_manual_publish_dialog_opened", {});
                    setPublishMenuOpen(false);
                    // Plain upload, not a review resubmit — clear any review
                    // context left over from an earlier 提交审核 click.
                    setReviewSkill(null);
                    setReviewInitial(null);
                    setCreateVisible(true);
                  }}
                >
                  <Upload size={16} />
                  <span>
                    <strong>{t("skillMarket.publishMenu.manualTitle")}</strong>
                    <small>{t("skillMarket.publishMenu.manualHint")}</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      </header>

      <section
        className={
          mine
            ? "skill-market-toolbar skill-market-toolbar--mine"
            : "skill-market-toolbar"
        }
      >
        {!mine && (
          <>
            <CategoryChips
              categories={list.categories}
              activeId={list.categoryId}
              onChange={list.setCategoryId}
            />
            <div
              className="skill-market-sort"
              aria-label={t("skillMarket.sort.ariaLabel")}
            >
              <div className="skill-market-sort__options">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-testid="skill-sort-option"
                    className={sort === option.value ? "is-active" : undefined}
                    aria-pressed={sort === option.value}
                    onClick={() => handleSortChange(option.value)}
                  >
                    <span>{t(option.labelKey)}</span>
                    {option.descending && <ArrowDown size={12} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <main className="skill-market-content">
        {list.loading && (
          <div
            className="skill-market-grid"
            aria-label={t("skillMarket.list.loadingAriaLabel")}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <SkillCardSkeleton key={index} />
            ))}
          </div>
        )}
        {list.error && (
          <div className="skill-market-state is-error">
            <AlertCircle size={28} />
            <strong>{t("skillMarket.common.loadFailed")}</strong>
            <span>{list.error}</span>
            <WKButton
              variant="secondary"
              icon={<RefreshCw size={15} />}
              onClick={list.refresh}
            >
              {t("skillMarket.list.retry")}
            </WKButton>
          </div>
        )}
        {!list.loading && !list.error && list.skills.length === 0 && (
          <div className="skill-market-state">
            <PackageOpen size={56} />
            <strong>{t("skillMarket.list.empty")}</strong>
          </div>
        )}
        {!list.loading && !list.error && list.skills.length > 0 && (
          mine ? (
            <MineTable
              rows={list.skills.map((skill) => {
                // Review affordances are mutually exclusive by construction: at
                // most one of pending / rejected / private / listed applies to a
                // given row. They are attached here (page level) and rendered by
                // the row component; the catalog branch below builds no such
                // fields, so a discovery card can never pick up owner actions.
                const reviewState = reviewStateByPlugin.get(skill.id);
                const pending = reviewState?.pending;
                const rejected = reviewState?.rejected;
                const isPrivate = skill.visibility === "private";
                // MineTable renders a precomputed badge instead of re-deriving one
                // from the request objects, so the union is resolved here. Order
                // matters: a pending request outranks a stale rejection, and on an
                // already-listed plugin "pending" means the live version stays up
                // while the new one is reviewed.
                const reviewBadge: MineReviewBadge = pending
                  ? isPrivate
                    ? "pending"
                    : "pending-upgrade"
                  : rejected
                    ? "rejected"
                    : isPrivate
                      ? "private"
                      : "live";
                return {
                id: skill.id,
                type: "skill" as const,
                trackItemType: "skill",
                icon: skill.iconUrl ? (
                  <img className="wk-mine-table__avatar-img" src={skill.iconUrl} alt="" />
                ) : (
                  <span
                    className="wk-mine-table__avatar-tile"
                    style={{ background: getSkillAvatarColor(skill.name) }}
                  >
                    {getSkillAvatarText(skill.name)}
                  </span>
                ),
                name: skill.displayName || skill.name,
                description: skill.description,
                category: list.categories.find((c) => c.id === skill.categoryId)?.name,
                version: skill.version,
                visibility: skill.visibility,
                views: skill.viewCount,
                downloads: skill.downloadCount,
                updatedAt: skill.updatedAt,
                ariaLabel: skill.name,
                onOpen: () => openDetail(skill),
                // 编辑 is withheld once a plugin is listed to the org. A direct edit
                // takes effect immediately for everyone, which would route around
                // review entirely — so a listed plugin changes only through
                // 发布新版本, and while a request is pending it does not change at
                // all (the live version stays up until a decision lands).
                onEdit: isPrivate && !pending ? () => setEditing(skill) : undefined,
                onDelete: () => setDeleting(skill),
                editAria: t("skillMarket.card.editAriaLabel", { values: { name: skill.name } }),
                deleteAria: t("skillMarket.card.deleteAriaLabel", { values: { name: skill.name } }),
                reviewBadge,
                rejectReason: rejected?.reason,
                onSubmitReview:
                  isPrivate && !pending && !rejected ? () => openReviewSubmit(skill) : undefined,
                onCancelReview: pending ? () => void handleCancelReview(pending.id) : undefined,
                onResubmit: rejected
                  ? () => openReviewSubmit(skill, rejected.changelog)
                  : undefined,
                onPublishVersion:
                  !isPrivate && !pending ? () => openReviewSubmit(skill) : undefined,
                };
              })}
              visibilityLabel={(v) => t(`skillMarket.visibility.${v}`)}
            />
          ) : (
            <div className="skill-market-grid">
              {list.skills.map((skill) => (
                // Discovery catalog. No owner-only props on purpose: SkillCard
                // derives `isOwnerCard` from callback presence, and review state
                // is applicant-scoped, so neither belongs on a public card.
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  categories={list.categories}
                  onOpen={openDetail}
                  onInstall={(item) => setInstallSkillId(item.id)}
                  showStats={false}
                />
              ))}
            </div>
          )
        )}
        <div ref={sentinelRef} className="skill-market-sentinel">
          {list.loadingMore ? (
            <span className="skill-market-sentinel__loading">
              <RefreshCw size={13} />
              {t("skillMarket.list.loadMore")}
            </span>
          ) : null}
        </div>
      </main>

      <SkillDetailModal
        skillId={detailId}
        categories={list.categories}
        refreshKey={detailRefreshKey}
        onClose={() => setDetailId(null)}
        onEdit={mine ? setEditing : undefined}
        onDelete={mine ? setDeleting : undefined}
      />
      <NewSkillModal
        visible={createVisible}
        categories={list.categories}
        onClose={closeCreate}
        onCreated={handleCreated}
        reviewSkill={reviewSkill}
        reviewInitial={reviewInitial}
      />
      <BotPublishModal
        visible={botPublishVisible}
        onClose={() => setBotPublishVisible(false)}
      />
      <EditSkillModal
        skill={editing}
        categories={list.categories}
        onClose={() => setEditing(null)}
        onUpdated={handleUpdated}
      />
      <InstallPromptModal
        skillId={installSkillId}
        onClose={() => setInstallSkillId(null)}
      />
      <DeleteConfirmModal
        skill={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={handleDeleted}
      />
      {toast &&
        createPortal(
          <div className="skill-market-toast" role="status">
            {toast}
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label={t("skillMarket.list.closeToast")}
            >
              ×
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
