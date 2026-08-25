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

type TabId = "skills" | "mine";

const TOAST_DURATION = 3000;
const SORT_OPTIONS: Array<{ value: SkillSort; labelKey: string; descending?: boolean }> = [
  { value: "comprehensive", labelKey: "skillMarket.sort.comprehensive" },
  { value: "latest", labelKey: "skillMarket.sort.latest" },
  { value: "downloads", labelKey: "skillMarket.sort.downloads", descending: true },
  { value: "views", labelKey: "skillMarket.sort.views", descending: true },
];

export default function SkillListPage() {
  useI18n();
  const [tab, setTab] = useState<TabId>("skills");
  const mine = tab === "mine";
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SkillSort>("comprehensive");
  const list = useSkills({ mine, selectedTags, sort });
  const refreshRef = useRef(list.refresh);
  const [createVisible, setCreateVisible] = useState(false);
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
      setBotPublishVisible(false);
      setDetailId(null);
      setEditing(null);
      setDeleting(null);
      setInstallSkillId(null);
      refreshRef.current();
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

  function switchTab(next: TabId) {
    if (next === tab) return;
    // 用户切换视图 Tab;原先误用 GET /skills/mine 加载推断,而 mine 列表也用于建议/初始化。
    Dap.shared.track("market_view_switched", {});
    setTab(next);
  }

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

  function handleCreated() {
    showToast(t("skillMarket.list.created"));
    list.refresh();
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

  // The unified list response carries an accurate, filter-scoped
  // pagination.total (surfaced as list.total). Bind the "共 N 个技能" headline to
  // it on both tabs so the count re-scopes with an active search/tag filter and
  // tracks the visible grid. The catalog category skillCount is search-invariant
  // and would otherwise show the whole-category total after a search.
  const summaryTotal = list.total;

  return (
    <div className="skill-market-page">
      <header className="skill-market-topbar">
        <nav
          className="skill-market-tabs"
          aria-label={t("skillMarket.list.navAriaLabel")}
        >
          <button
            type="button"
            className={tab === "skills" ? "is-active" : ""}
            onClick={() => switchTab("skills")}
          >
            {t("skillMarket.list.tabSkills")}
          </button>
          <button
            type="button"
            className={tab === "mine" ? "is-active" : ""}
            onClick={() => switchTab("mine")}
          >
            {t("skillMarket.list.mine")}
          </button>
        </nav>
        <div className="skill-market-topbar__actions">
          <SearchBar
            ref={searchInputRef}
            value={list.query}
            onChange={list.setQuery}
            placeholder={t("skillMarket.filter.searchNameDescription")}
            selectedTags={selectedTags}
            onSelectedTagsChange={handleSelectedTagsChange}
            autoFocus
          />
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
          <CategoryChips
            categories={list.categories}
            activeId={list.categoryId}
            onChange={list.setCategoryId}
          />
        )}
      </section>

      <main className="skill-market-content">
        {!list.loading && !list.error && (
          <div className="skill-market-result-summary">
            <span className="skill-market-result-summary__total" aria-live="polite">
              {t("skillMarket.list.totalCount", {
                values: { count: summaryTotal },
              })}
            </span>
            {!mine && (
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
                      className={
                        sort === option.value ? "is-active" : undefined
                      }
                      aria-pressed={sort === option.value}
                      onClick={() => handleSortChange(option.value)}
                    >
                      <span>{t(option.labelKey)}</span>
                      {option.descending && <ArrowDown size={12} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
          <div className="skill-market-grid">
            {list.skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                categories={list.categories}
                onOpen={openDetail}
                onEdit={mine ? setEditing : undefined}
                onDelete={mine ? setDeleting : undefined}
                onInstall={(item) => setInstallSkillId(item.id)}
              />
            ))}
          </div>
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
        onClose={() => setCreateVisible(false)}
        onCreated={handleCreated}
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
