// The per-message "更多" (⋯) overflow menu — prototype spec 视觉目标 §6 + §四.
//
// WHY A MENU AND NOT INLINE BUTTONS: the drawer is 360px wide. Two always-visible text buttons
// ("编辑" / "删除") under every message is what made the panel read as noisy, and it put a
// destructive action one stray click away. The prototype hides both behind a 28px icon trigger that
// only MATERIALISES on hover / keyboard focus / while the thread is selected.
//
// The trigger is `opacity: 0`, NOT `display: none` (styles.css) — it keeps its 28px box at all
// times, so revealing it cannot reflow the message head. That is a deliberate spec requirement: a
// display-toggled trigger makes every card twitch as the pointer moves down the list.
//
// PERMISSIONS ARE THE CALLER'S: this component renders exactly the items it is handed. The
// author/role decisions stay in CommentPanel (which re-checks them on submit for the runtime
// downgrade fail-closed path), so this file has no idea what a Role is.

import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'

export interface MessageActionItem {
  key: string
  label: string
  onSelect: () => void
  /** Renders in the error colour (delete). */
  danger?: boolean
  disabled?: boolean
}

export function MessageActions({ items }: { items: MessageActionItem[] }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Fail closed: if the last actionable item disappears (role downgrade) while the menu is open,
  // the menu must not linger as an empty popover.
  useEffect(() => {
    if (open && items.length === 0) setOpen(false)
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="octo-comment-actions-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="octo-comment-more"
        aria-label={t('docs.comment.moreActions')}
        title={t('docs.comment.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Linear stroke icon, 16×16, stroke-width 1.8, round caps (spec §六). */}
        <svg className="octo-comment-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3.5" cy="8" r="1.15" />
          <circle cx="8" cy="8" r="1.15" />
          <circle cx="12.5" cy="8" r="1.15" />
        </svg>
      </button>
      {open && (
        <div className="octo-comment-menu" id={menuId} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`octo-comment-menu-item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
