// Shared confirm dialog for destructive actions (delete), centered in the middle of the screen.
// Replaces both the sheet's native window.confirm and the document's inline top banner, so a
// document delete and a sheet delete look identical: one centered modal card.
//
// Self-contained plain-React modal (no antd, no portal): a fixed full-screen overlay centers the
// card both axes. Closes on overlay pointer-down and on Escape — but never while `busy` (a delete
// is in flight), so the confirm can't be dismissed mid-request.

import { useEffect, type ReactNode } from 'react'

export interface ConfirmModalProps {
  /** When false the modal is unmounted (renders nothing). */
  open: boolean
  /** Short heading (e.g. "删除文档"). */
  title: string
  /** Body text / detail line. */
  message?: ReactNode
  /** Confirm button label. */
  confirmLabel: string
  /** Cancel button label. */
  cancelLabel: string
  /** Paint the confirm button red for destructive actions. */
  danger?: boolean
  /** Disable both buttons + block dismiss while the confirmed action is in flight. */
  busy?: boolean
  /** Optional error line shown above the actions (e.g. a failed delete). */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div
      className="octo-confirm-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="octo-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="octo-confirm-title">{title}</h3>
        {message && <p className="octo-confirm-message">{message}</p>}
        {error && (
          <p className="octo-member-error" role="alert">
            {error}
          </p>
        )}
        <div className="octo-confirm-actions">
          <button type="button" className="octo-tb-btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'octo-tb-btn octo-confirm-go-danger' : 'octo-tb-btn'}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
