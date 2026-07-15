import { useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { PortalMenu } from './PortalMenu.tsx'
import { DOC_TYPES, type DocType } from './docsApi.ts'

/**
 * i18n label key per document kind. The candidates are the fixed 3-value {@link DOC_TYPES} enum
 * (doc/sheet/board), so — unlike the creator facet — there is NO server `type-facet` endpoint: the
 * dropdown writes the candidate set directly and reuses the same labels the list-row icon uses
 * (docs.list.kind*), keeping the filter and the rows consistent (XIN-1188).
 */
const TYPE_LABEL_KEY: Record<DocType, string> = {
  doc: 'docs.list.kindDoc',
  sheet: 'docs.list.kindSheet',
  board: 'docs.list.kindBoard',
}

/** Shared kind label so the dropdown and the chips label a type identically. */
export function typeLabel(ty: DocType): string {
  return t(TYPE_LABEL_KEY[ty])
}

/**
 * Multi-select document-kind filter (frontend-design §5.2 / XIN-1188). Completely mirrors
 * CreatorFilter: a body-portal menu (PortalMenu) of checkbox rows, reusing the `.octo-docs-filter*`
 * CSS. Present on BOTH tabs (unlike the creator filter, which is recent-only). Selections are OR'd
 * server-side and AND-combined with the filename search (and, on recent, with the creator filter).
 * The button shows the selected count; chips (see TypeChips) render below the toolbar.
 */
export function TypeFilter({
  selected,
  onToggle,
}: {
  selected: DocType[]
  onToggle: (ty: DocType) => void
}): React.ReactElement {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const open = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt(at ? null : { left: r.left, top: r.bottom + 6 })
  }

  const label =
    selected.length > 0
      ? `${t('docs.filter.type')} (${selected.length})`
      : t('docs.filter.type')

  return (
    <div className="octo-docs-filter">
      <button
        ref={btnRef}
        type="button"
        className={
          selected.length > 0
            ? 'octo-docs-filter-btn octo-docs-filter-btn-active'
            : 'octo-docs-filter-btn'
        }
        aria-haspopup="menu"
        aria-expanded={at != null}
        onClick={open}
      >
        {label}
        <span className="octo-docs-filter-caret" aria-hidden="true">▾</span>
      </button>
      {at && (
        <PortalMenu at={at} onClose={() => setAt(null)} minWidth={200}>
          {DOC_TYPES.map((ty) => {
            const checked = selected.includes(ty)
            return (
              <label key={ty} className="octo-docs-filter-option">
                <input type="checkbox" checked={checked} onChange={() => onToggle(ty)} />
                <span className="octo-docs-filter-option-name">{typeLabel(ty)}</span>
              </label>
            )
          })}
        </PortalMenu>
      )}
    </div>
  )
}

/**
 * Chips row for the selected types (frontend-design §5.2). Each chip removes its type; a trailing
 * "clear all" clears the filter. Rendered below the toolbar only when something is selected — a
 * direct mirror of CreatorChips.
 */
export function TypeChips({
  selected,
  onToggle,
  onClearAll,
}: {
  selected: DocType[]
  onToggle: (ty: DocType) => void
  onClearAll: () => void
}): React.ReactElement | null {
  if (selected.length === 0) return null
  return (
    <div className="octo-docs-filter-chips">
      {selected.map((ty) => (
        <span key={ty} className="octo-docs-filter-chip">
          {typeLabel(ty)}
          <button
            type="button"
            className="octo-docs-filter-chip-x"
            aria-label={typeLabel(ty)}
            onClick={() => onToggle(ty)}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="octo-docs-filter-clear" onClick={onClearAll}>
        {t('docs.filter.clearAll')}
      </button>
    </div>
  )
}
