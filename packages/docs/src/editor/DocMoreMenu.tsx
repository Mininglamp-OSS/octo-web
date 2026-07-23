import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../octoweb/index.ts'

/**
 * A single row in the header "more" (≡) dropdown. `danger` paints the row red (delete);
 * `disabled` greys it and blocks the click (e.g. export while a previous export is in flight).
 */
export interface DocMoreMenuItem {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /**
   * Optional nested rows. When present the row acts as an expandable submenu: clicking it toggles
   * the children instead of firing `onClick`. Used by the export row to fan out into
   * Markdown / Word / PDF without leaving the ≡ menu.
   */
  children?: DocMoreMenuItem[]
}

export interface DocMoreMenuProps {
  /** Resolved creator display name. The parent handles the resolution + fallback (short uid). */
  creatorName: string
  /**
   * Optional avatar URL for the creator (parent-resolved). Rendered as an <img>; falls back to
   * the initial-letter chip when absent or when the image fails to load (e.g. missing user).
   */
  creatorAvatarUrl?: string | null
  /** Creation timestamp (RFC3339). Rendered as "Created on YYYY-MM-DD"; omitted when absent/invalid. */
  createdAt?: string
  /** Neutral action rows, rendered top-to-bottom in the given order. */
  items: DocMoreMenuItem[]
  /**
   * The destructive row (delete). Rendered LAST, below a dedicated separator + extra spacing so it
   * sits apart from the neutral actions and is hard to mis-click. Omitted when the viewer can't delete.
   */
  dangerItem?: DocMoreMenuItem
}

/**
 * Format an RFC3339 / ISO-8601 timestamp as `YYYY-MM-DD`. A leading `YYYY-MM-DD` is sliced
 * lexically so the displayed calendar date matches the stored date exactly — no timezone drift
 * from `Date` parsing. Anything else falls back to a parsed local date; unparseable input yields
 * null so the caller drops the row instead of showing "Invalid Date".
 */
export function formatCreatedDate(raw?: string): string | null {
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** First visible character of the creator name, uppercased, for the fallback avatar bubble. */
function avatarInitial(name: string): string {
  const c = name.trim().charAt(0)
  return c ? c.toUpperCase() : '?'
}

/** ≡ trigger glyph — three horizontal lines, 20×20, 1.5 stroke (Jeff's spec). */
function HamburgerIcon() {
  return (
    <svg className="octo-doc-more-glyph" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M4 6h12M4 10h12M4 14h12" />
    </svg>
  )
}

/** Base 20×20 line-icon wrapper for the menu rows (stroke inherits currentColor). */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="octo-doc-more-rowicon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {children}
    </svg>
  )
}

/** ↗ open in a new page. */
export const OpenNewPageIcon = (
  <RowIcon>
    <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12" />
    <path d="M11 4h5v5M16 4l-7 7" />
  </RowIcon>
)

/** 🔗 copy link (chain). */
export const LinkIcon = (
  <RowIcon>
    <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1" />
    <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1" />
  </RowIcon>
)

/** 🕐 version history (clock). */
export const HistoryIcon = (
  <RowIcon>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 6.5V10l2.5 1.5" />
  </RowIcon>
)

/** ⬇ export / download. */
export const ExportIcon = (
  <RowIcon>
    <path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9" />
    <path d="M4.5 15.5h11" />
  </RowIcon>
)

/** 🗑 delete (trash). */
export const DeleteIcon = (
  <RowIcon>
    <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5A1 1 0 0 0 7.7 16.5h4.6a1 1 0 0 0 1-.99L14 6" />
    <path d="M8.5 8.5v5M11.5 8.5v5" />
  </RowIcon>
)

/** ▸ caret shown on submenu rows; rotates to ▾ when expanded (CSS `.is-open`). */
function CaretIcon() {
  return (
    <svg className="octo-doc-more-caret" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M8 6l4 4-4 4" />
    </svg>
  )
}

function MenuRow({ item, onSelect }: { item: DocMoreMenuItem; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasChildren = !!item.children && item.children.length > 0

  if (hasChildren) {
    return (
      <li role="none">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={expanded}
          className={expanded ? 'octo-doc-more-item is-parent is-open' : 'octo-doc-more-item is-parent'}
          disabled={item.disabled}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="octo-doc-more-icon">{item.icon}</span>
          <span className="octo-doc-more-label">{item.label}</span>
          <CaretIcon />
        </button>
        {expanded && (
          <ul className="octo-doc-more-list octo-doc-more-sublist" role="menu">
            {item.children!.map((child) => (
              <MenuRow key={child.key} item={child} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        className={item.danger ? 'octo-doc-more-item is-danger' : 'octo-doc-more-item'}
        disabled={item.disabled}
        onClick={() => {
          onSelect()
          item.onClick()
        }}
      >
        <span className="octo-doc-more-icon">{item.icon}</span>
        <span className="octo-doc-more-label">{item.label}</span>
      </button>
    </li>
  )
}

/** Avatar cell for the ≡ menu head: <img> when URL loads, initial-letter chip otherwise (also on onError). */
function CreatorAvatar({ name, url }: { name: string; url?: string | null }) {
  const [failed, setFailed] = useState(false)
  const showImg = !!url && !failed
  if (showImg) {
    return (
      <img className="octo-doc-more-avatar" src={url} alt="" title={name} onError={() => setFailed(true)} />
    )
  }
  return (
    <span className="octo-doc-more-avatar" aria-hidden="true">
      {avatarInitial(name)}
    </span>
  )
}

/**
 * Header "more" (≡) dropdown for the document editor. Collapses the low-frequency title-bar
 * actions (open in new page / version history / export / delete) behind a single ≡ affordance at
 * the far right of the header, and shows a light info head (creator + created date) above them.
 *
 * Self-contained plain-React popover (no antd, no portal): a relatively-positioned wrapper anchors
 * an absolutely-positioned panel below the trigger. Closes on outside pointer-down and on Escape.
 */
export function DocMoreMenu({ creatorName, creatorAvatarUrl, createdAt, items, dangerItem }: DocMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const createdOn = formatCreatedDate(createdAt)

  return (
    <div className="octo-doc-more" ref={wrapRef}>
      <button
        type="button"
        className={open ? 'octo-doc-more-btn is-active' : 'octo-doc-more-btn'}
        title={t('docs.toolbar.more')}
        aria-label={t('docs.toolbar.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <HamburgerIcon />
      </button>
      {open && (
        <div className="octo-doc-more-panel" role="menu">
          <div className="octo-doc-more-head">
            <div className="octo-doc-more-creator">
              <CreatorAvatar name={creatorName} url={creatorAvatarUrl} />
              <span className="octo-doc-more-name" title={creatorName}>
                {creatorName}
              </span>
            </div>
            {createdOn && (
              <div className="octo-doc-more-created">
                {t('docs.moreMenu.createdPrefix')} {createdOn}
              </div>
            )}
          </div>
          <ul className="octo-doc-more-list">
            {items.map((item) => (
              <MenuRow key={item.key} item={item} onSelect={close} />
            ))}
          </ul>
          {dangerItem && (
            <>
              <div className="octo-doc-more-sep" />
              <ul className="octo-doc-more-list octo-doc-more-danger-group">
                <MenuRow item={dangerItem} onSelect={close} />
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
