import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

// A select-style search field for the global-search filter panel. It mirrors
// the ChannelSearch "发送者" combobox — a field that holds the picked chips +
// a type-to-filter input, backed by a listbox dropdown — so the two search
// surfaces read the same. It intentionally reuses ChannelSearch's existing CSS
// (`wk-channel-search-sender-*` field/dropdown + `wk-channel-search-filter-*`
// chip/check) rather than introducing new classes or colors; those class
// definitions ship in ChannelSearch/index.css and resolve against the
// `--channel-search-*` -> `--wk-*` token map declared on `.wk-global-content-
// search` (see global-content-search-panel.css).
//
// It is a controlled/presentational component: the panel owns the query state,
// candidate loading (debounced dataSource.searchSenders / searchChannels), and
// the selection reducer. This keeps the YUJ-16 RC data-source wiring untouched.

export interface FilterSearchOption {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface FilterSearchSelectProps {
  title: string;
  /** Placeholder shown in the input when no chip is selected. */
  placeholder?: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Candidate rows for the dropdown (already filtered by the loader). */
  options: FilterSearchOption[];
  /** Currently-picked rows, rendered as removable chips inside the field. */
  selected: FilterSearchOption[];
  isSelected: (id: string) => boolean;
  /** Add when not selected, remove when selected. */
  onToggle: (id: string) => void;
  /** Copy shown in the dropdown when there is no candidate. */
  emptyHint?: string;
  /** Cap on rendered dropdown rows (defaults to 30, matching the old panel). */
  maxOptions?: number;
  /** Stable id for the listbox, wired to aria-controls. */
  listboxId: string;
}

const FilterSearchSelect: React.FC<FilterSearchSelectProps> = ({
  title,
  placeholder,
  query,
  onQueryChange,
  options,
  selected,
  isSelected,
  onToggle,
  emptyHint,
  maxOptions = 30,
  listboxId,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hasValues = selected.length > 0;
  const visibleOptions = useMemo(
    () => options.slice(0, maxOptions),
    [options, maxOptions]
  );

  // Close the dropdown on any pointer-down outside the field. The panel only
  // stops click propagation, so a document-level mousedown still reaches here.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="wk-channel-search-filter-section">
      <div className="wk-channel-search-filter-title">{title}</div>
      <div className="wk-channel-search-sender-wrap" ref={wrapRef}>
        <div
          className={[
            "wk-channel-search-sender-field",
            hasValues ? "has-values" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {selected.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="wk-channel-search-filter-chip"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(opt.id);
              }}
            >
              {opt.avatarUrl && (
                <img
                  className="wk-channel-search-filter-avatar"
                  src={opt.avatarUrl}
                  alt=""
                />
              )}
              {opt.name}
              <X size={12} />
            </button>
          ))}
          <input
            type="text"
            aria-label={placeholder}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={hasValues ? "" : placeholder}
          />
          <ChevronDown size={16} />
        </div>
        {open && (
          <div
            className="wk-channel-search-filter-senders"
            id={listboxId}
            role="listbox"
          >
            {visibleOptions.map((opt) => {
              const active = isSelected(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  className={active ? "is-selected" : undefined}
                  onClick={() => {
                    // Mirror ChannelSearch's chooseSender pattern (packages/
                    // dmworkbase/src/Components/ChannelSearch/index.tsx —
                    // toggle + clear the typed query + keep the dropdown
                    // open so the user can immediately pick another
                    // candidate). Without the reset the input keeps the
                    // narrowing text after a pick and users have to
                    // manually clear it before searching the next name.
                    onToggle(opt.id);
                    onQueryChange("");
                    setOpen(true);
                  }}
                >
                  <span className="wk-channel-search-filter-check" />
                  {opt.avatarUrl && (
                    <img
                      className="wk-channel-search-filter-avatar"
                      src={opt.avatarUrl}
                      alt=""
                    />
                  )}
                  <span className="wk-channel-search-filter-option-name">
                    {opt.name}
                  </span>
                </button>
              );
            })}
            {visibleOptions.length === 0 && emptyHint && (
              <span className="wk-global-search-filter-help">{emptyHint}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterSearchSelect;
