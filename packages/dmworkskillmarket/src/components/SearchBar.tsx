import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, SlidersHorizontal } from "lucide-react";
import { t, useI18n } from "@octo/base";
import { getSkillTags } from "../api/skillApi";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  selectedTags?: string[];
  onSelectedTagsChange?: (tags: string[]) => void;
}

const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar(
    {
      value,
      onChange,
      placeholder = t("skillMarket.common.search"),
      autoFocus = false,
      selectedTags = [],
      onSelectedTagsChange,
    },
    ref
  ) {
    useI18n();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [tagOpen, setTagOpen] = useState(false);
    const [tagQuery, setTagQuery] = useState("");
    const [tagOptions, setTagOptions] = useState<string[]>([]);
    const tagEnabled = Boolean(onSelectedTagsChange);

    useEffect(() => {
      if (typeof ref === "function") {
        ref(inputRef.current);
      } else if (ref) {
        ref.current = inputRef.current;
      }
    }, [ref]);

    useEffect(() => {
      if (!autoFocus) return;
      inputRef.current?.focus();
    }, [autoFocus]);

    useEffect(() => {
      if (!tagOpen) return undefined;

      function handleClick(event: MouseEvent) {
        if (
          rootRef.current &&
          !rootRef.current.contains(event.target as Node)
        ) {
          setTagOpen(false);
        }
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setTagOpen(false);
        }
      }

      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [tagOpen]);

    useEffect(() => {
      if (!tagEnabled || !tagOpen) return undefined;
      const controller = new AbortController();
      const timer = window.setTimeout(() => {
        getSkillTags(tagQuery, { signal: controller.signal })
          .then((items) => setTagOptions(items.map((item) => item.name)))
          .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError")
              return;
            setTagOptions([]);
          });
      }, 160);

      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }, [tagEnabled, tagOpen, tagQuery]);

    const visibleTags = useMemo(() => {
      const merged = [...selectedTags, ...tagOptions];
      return Array.from(new Set(merged)).filter((tag) =>
        tag.toLowerCase().includes(tagQuery.trim().toLowerCase())
      );
    }, [selectedTags, tagOptions, tagQuery]);

    function toggleTag(tag: string) {
      if (!onSelectedTagsChange) return;
      const selected = selectedTags.includes(tag);
      onSelectedTagsChange(
        selected
          ? selectedTags.filter((item) => item !== tag)
          : [...selectedTags, tag]
      );
    }

    function clearTags() {
      onSelectedTagsChange?.([]);
    }

    return (
      <div ref={rootRef} className="skill-market-search">
        <div className="skill-market-search__control">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            autoFocus={autoFocus}
          />
          {tagEnabled && (
            <div className="skill-market-tag-filter">
              <button
                type="button"
                className={
                  selectedTags.length > 0
                    ? "skill-market-tag-filter__trigger is-active"
                    : "skill-market-tag-filter__trigger"
                }
                aria-expanded={tagOpen}
                aria-haspopup="listbox"
                onClick={() => setTagOpen((open) => !open)}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                {t("skillMarket.filter.tags")}
              </button>
              {tagOpen && (
                <div className="skill-market-tag-filter__popover">
                  <label className="skill-market-tag-filter__search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      value={tagQuery}
                      onChange={(event) => setTagQuery(event.target.value)}
                      placeholder={t("skillMarket.filter.searchTags")}
                      aria-label={t("skillMarket.filter.searchTags")}
                      autoFocus
                    />
                  </label>
                  <div
                    className="skill-market-tag-filter__list"
                    role="listbox"
                    aria-label={t("skillMarket.filter.tags")}
                  >
                    {visibleTags.length > 0 ? (
                      visibleTags.map((tag) => {
                        const selected = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            className={
                              selected
                                ? "skill-market-tag-filter__option is-active"
                                : "skill-market-tag-filter__option"
                            }
                            role="option"
                            aria-selected={selected}
                            title={tag}
                            onClick={() => toggleTag(tag)}
                          >
                            <span className="skill-market-tag-filter__check">
                              {selected && (
                                <Check size={15} aria-hidden="true" />
                              )}
                            </span>
                            <span>{tag}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="skill-market-tag-filter__empty">
                        {t("skillMarket.filter.noTags")}
                      </div>
                    )}
                  </div>
                  <div className="skill-market-tag-filter__footer">
                    <span>
                      {selectedTags.length > 0
                        ? t("skillMarket.filter.tagsSelected")
                        : t("skillMarket.filter.noTagsSelected")}
                    </span>
                    <button
                      type="button"
                      onClick={clearTags}
                      disabled={selectedTags.length === 0}
                    >
                      {t("skillMarket.filter.clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default SearchBar;
