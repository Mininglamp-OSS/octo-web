import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { Category } from "../types/skill";

interface CategoryChipsProps {
  categories: Category[];
  activeId: string;
  onChange: (categoryId: string) => void;
}

const MEDIUM_VISIBLE_LIMIT = 4;

export default function CategoryChips({ categories, activeId, onChange }: CategoryChipsProps) {
  useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function handleClick(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen]);
  const ordered = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.id === "all") return -1;
      if (b.id === "all") return 1;
      if (a.skillCount > 0 && b.skillCount === 0) return -1;
      if (a.skillCount === 0 && b.skillCount > 0) return 1;
      return a.sortOrder - b.sortOrder;
    });
  }, [categories]);

  const mediumBase = ordered.slice(0, MEDIUM_VISIBLE_LIMIT);
  const mediumVisibleIds = new Set(mediumBase.map((category) => category.id));
  const mediumOverflow = ordered.filter((category) => !mediumVisibleIds.has(category.id));
  const mobileOnlyMenuItems = ordered.filter(
    (category) => category.id !== "all" && mediumVisibleIds.has(category.id),
  );
  const showMore = mediumOverflow.length > 0 || mobileOnlyMenuItems.length > 0;

  function choose(categoryId: string) {
    onChange(categoryId);
    setMoreOpen(false);
  }

  function renderChip(category: Category, className = "skill-market-category-chip") {
    return (
      <button
        key={category.id}
        type="button"
        className={
          category.id === activeId
            ? `${className} is-active`
            : className
        }
        aria-pressed={category.id === activeId}
        onClick={() => choose(category.id)}
        title={category.name}
      >
        <span className="skill-market-category-label">{category.name}</span>
      </button>
    );
  }

  return (
    <div className="skill-market-category-strip" aria-label={t("skillMarket.category.ariaLabel")}>
      {ordered.map((category) => renderChip(
        category,
        mediumVisibleIds.has(category.id) || category.id === activeId
          ? "skill-market-category-chip"
          : "skill-market-category-chip skill-market-category-chip--medium-overflow",
      ))}
      {ordered.slice(0, 1).map((category) => renderChip(category, "skill-market-category-chip skill-market-category-chip--mobile-primary"))}
      {showMore && (
        <div className="skill-market-category-more" ref={moreRef}>
          <button
            type="button"
            className="skill-market-category-chip skill-market-category-more__button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span className="skill-market-category-label">{t("skillMarket.common.more")}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {moreOpen && (
            <div className="skill-market-category-menu" role="menu">
              {mediumOverflow.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="menuitem"
                  className={category.id === activeId ? "is-active" : undefined}
                  onClick={() => choose(category.id)}
                >
                  <span>{category.name}</span>
                </button>
              ))}
              {mobileOnlyMenuItems.map((category) => (
                <button
                  key={`mobile-${category.id}`}
                  type="button"
                  role="menuitem"
                  className={
                    category.id === activeId
                      ? "skill-market-category-menu__mobile-only is-active"
                      : "skill-market-category-menu__mobile-only"
                  }
                  onClick={() => choose(category.id)}
                >
                  <span>{category.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
