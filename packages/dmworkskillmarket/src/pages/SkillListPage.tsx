import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  PackageOpen,
  RefreshCw,
  Upload,
} from "lucide-react";
import { t, useI18n, WKApp, WKButton } from "@octo/base";
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
const SORT_OPTIONS: Array<{ value: SkillSort; labelKey: string }> = [
  { value: "comprehensive", labelKey: "skillMarket.sort.comprehensive" },
  { value: "latest", labelKey: "skillMarket.sort.latest" },
  { value: "views", labelKey: "skillMarket.sort.views" },
  { value: "downloads", labelKey: "skillMarket.sort.downloads" },
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
    setTab(next);
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
    list.markSkillViewed(item.id);
    setDetailId(item.id);
  }

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
            Skills
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
            onSelectedTagsChange={setSelectedTags}
            autoFocus
          />
          <div className="skill-market-publish-menu" ref={publishMenuRef}>
            <WKButton
              variant="primary"
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
                  onClick={() => {
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
              <span className="skill-market-sort__label">
                {t("skillMarket.sort.label")}
              </span>
              <div className="skill-market-sort__options">
                {SORT_OPTIONS.map((option, index) => (
                  <React.Fragment key={option.value}>
                    {index > 0 && (
                      <span className="skill-market-sort__separator">·</span>
                    )}
                    <button
                      type="button"
                      className={
                        sort === option.value ? "is-active" : undefined
                      }
                      onClick={() => setSort(option.value)}
                    >
                      {t(option.labelKey)}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <main className="skill-market-content">
        {!list.loading && !list.error && (
          <div className="skill-market-result-summary" aria-live="polite">
            <span className="skill-market-result-summary__total">
              {t("skillMarket.list.totalCount", {
                values: { count: list.total },
              })}
            </span>
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
