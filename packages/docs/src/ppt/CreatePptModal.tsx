// Create-slides template picker (R2-F1 / design appendix §2–§4).
//
// A self-contained, keyboard-accessible modal: a real native <dialog>, a `role="radiogroup"` of
// four `role="radio"` template cards (16:9 preview + name + scene), a required title input, and a
// Create / Cancel footer. It ONLY collects a {template, title} choice and POSTs it to
// `POST /api/v1/ppt/docs` with a client `Idempotency-Key`; on success it hands the caller the
// BACKEND-returned editor route to navigate to (never a frontend-built route — no-fallthrough
// contract). No empty deck is precreated before submit.
//
// Hard acceptance bars (design appendix): keyboard semantics (radiogroup + arrow keys + Space/Enter
// + Esc-restores-focus + visible focus ring, PPT-UI-001), trust-the-backend-route + inline 400,
// and double-submit prevention with idempotency-key reuse on retry.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import {
  createPptDoc,
  DEFAULT_PPT_TEMPLATE,
  newIdempotencyKey,
  PPT_TEMPLATES,
  PPT_TITLE_MAX,
  type PptTemplateId,
} from './createPptTask.ts'
import './CreatePptModal.css'

export interface CreatePptModalProps {
  open: boolean
  /** Active space — resets the draft when it changes (mirrors CreateHtmlModal). */
  spaceId: string
  /** Optional target folder passed straight through to the create call. */
  folderId?: string
  onClose(): void
  /** Called with the backend-returned editor route after a successful create. NOT called on cancel. */
  onCreated(editorUrl: string): void
}

/**
 * Distinct 16:9 line-drawn preview per template (no bespoke colours — inherits currentColor so it
 * themes with the card). Purely decorative: the accessible name of the card is its aria-label
 * (template name + scene), so the SVG is aria-hidden.
 */
function TemplatePreview({ id }: { id: PptTemplateId }): React.ReactElement {
  const common = {
    width: '100%',
    viewBox: '0 0 160 90',
    fill: 'none',
    'aria-hidden': true as const,
    preserveAspectRatio: 'xMidYMid meet',
  }
  const frame = (
    <rect x="1" y="1" width="158" height="88" rx="6" stroke="currentColor" strokeWidth="1.5" />
  )
  switch (id) {
    case 'blank':
      return (
        <svg {...common} className="octo-ppt-tpl-preview">
          {frame}
        </svg>
      )
    case 'pitch':
      return (
        <svg {...common} className="octo-ppt-tpl-preview">
          {frame}
          <rect x="18" y="24" width="70" height="10" rx="2" fill="currentColor" opacity="0.85" />
          <rect x="18" y="42" width="52" height="6" rx="2" fill="currentColor" opacity="0.5" />
          <rect x="18" y="54" width="44" height="6" rx="2" fill="currentColor" opacity="0.5" />
          <circle cx="122" cy="45" r="20" stroke="currentColor" strokeWidth="1.5" />
          <path d="M122 45 122 25 A20 20 0 0 1 139 55 Z" fill="currentColor" opacity="0.6" />
        </svg>
      )
    case 'report':
      return (
        <svg {...common} className="octo-ppt-tpl-preview">
          {frame}
          <rect x="18" y="18" width="60" height="8" rx="2" fill="currentColor" opacity="0.85" />
          <rect x="20" y="66" width="14" height="8" fill="currentColor" opacity="0.5" />
          <rect x="42" y="54" width="14" height="20" fill="currentColor" opacity="0.6" />
          <rect x="64" y="44" width="14" height="30" fill="currentColor" opacity="0.7" />
          <rect x="86" y="34" width="14" height="40" fill="currentColor" opacity="0.85" />
          <path d="M112 60 L124 48 L134 54 L144 38" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'lesson':
      return (
        <svg {...common} className="octo-ppt-tpl-preview">
          {frame}
          <rect x="16" y="16" width="128" height="42" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
          <path d="M30 30 H120 M30 38 H110 M30 46 H96" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <rect x="60" y="66" width="40" height="6" rx="2" fill="currentColor" opacity="0.5" />
        </svg>
      )
  }
}

export function CreatePptModal({
  open,
  spaceId,
  folderId,
  onClose,
  onCreated,
}: CreatePptModalProps): React.ReactElement | null {
  const [selected, setSelected] = useState<PptTemplateId>(DEFAULT_PPT_TEMPLATE)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  // The element focused before the modal opened, restored on close (design §3 focus trap + restore).
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // Idempotency key for the CURRENT submit session: minted once per open and REUSED across retries
  // so a lost-response retry never mints a duplicate deck (hard metric #3). Reset on each open.
  const idempotencyKeyRef = useRef<string>('')

  const titleId = useId()
  const groupId = useId()
  const titleFieldId = useId()
  const errorId = useId()

  // Template metadata (name + scene) resolved from i18n; memoised on locale-stable keys.
  const templates = useMemo(
    () =>
      PPT_TEMPLATES.map((id) => ({
        id,
        name: t(`docs.ppt.template.${id}.name`),
        desc: t(`docs.ppt.template.${id}.desc`),
      })),
    [],
  )

  // Reset the draft whenever the modal opens or the space changes; mint a fresh idempotency key for
  // the new submit session and remember what to restore focus to.
  useEffect(() => {
    if (!open) return
    setSelected(DEFAULT_PPT_TEMPLATE)
    setTitle('')
    setSubmitting(false)
    setError(null)
    idempotencyKeyRef.current = newIdempotencyKey()
    restoreFocusRef.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }, [open, spaceId])

  // Open the native dialog and, on close, restore focus to the trigger (caret menu item).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    // Focus the default-selected template card so keyboard/SR users get a clear start point (§2.2).
    const startIdx = PPT_TEMPLATES.indexOf(DEFAULT_PPT_TEMPLATE)
    cardRefs.current[startIdx]?.focus()
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  const trimmed = title.trim()
  const tooLong = title.length > PPT_TITLE_MAX
  const canSubmit = trimmed.length > 0 && !tooLong && !submitting

  // Cancel/Esc/overlay dismissal — blocked while a create is in flight so the request can't be
  // orphaned mid-submit (the retry would otherwise mint under a fresh key on reopen).
  const requestClose = () => {
    if (submitting) return
    onClose()
  }

  // Roving-tabindex arrow navigation across the 4 radio cards. Arrows move selection AND focus
  // (selection-follows-focus); Home/End jump to the ends. Space/Enter confirm via the button's
  // native click → onSelect (handled below), so they need no special-casing here.
  const onCardKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % PPT_TEMPLATES.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + PPT_TEMPLATES.length) % PPT_TEMPLATES.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = PPT_TEMPLATES.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    setSelected(PPT_TEMPLATES[next])
    cardRefs.current[next]?.focus()
  }

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createPptDoc({
        title: trimmed,
        templateId: selected,
        folderId,
        idempotencyKey: idempotencyKeyRef.current,
      })
      // Trust the backend route ONLY — no frontend fallback (preserves R1 no-fallthrough).
      onCreated(result.editorUrl)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      // 400 → inline validation error, modal stays open, no navigation (hard metric #2).
      // Everything else (401/409/5xx/missing editorUrl/network) → generic error, modal stays open
      // and retriable; the same idempotency key is reused so a retry never duplicates a deck.
      setError(status === 400 ? t('docs.ppt.create.validationError') : t('docs.ppt.create.error'))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="octo-ppt-create-overlay"
      role="presentation"
      onMouseDown={requestClose}
      data-screen-label="docs-create-ppt"
    >
      <dialog
        ref={dialogRef}
        className="octo-ppt-create-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault()
          requestClose()
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="octo-ppt-create-header">
          <h3 id={titleId} className="octo-ppt-create-title">
            {t('docs.ppt.create.title')}
          </h3>
        </header>

        <form
          className="octo-ppt-create-body"
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          {/* Template picker — radiogroup with roving tabindex (§3). */}
          <div className="octo-ppt-create-field">
            <span id={groupId} className="octo-ppt-create-label">
              {t('docs.ppt.create.templateLabel')}
            </span>
            <div
              className="octo-ppt-create-grid"
              role="radiogroup"
              aria-labelledby={groupId}
            >
              {templates.map((tpl, i) => {
                const isSelected = selected === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    ref={(el) => {
                      cardRefs.current[i] = el
                    }}
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`${tpl.name} — ${tpl.desc}`}
                    tabIndex={isSelected ? 0 : -1}
                    className={
                      isSelected
                        ? 'octo-ppt-tpl-card octo-ppt-tpl-card-selected'
                        : 'octo-ppt-tpl-card'
                    }
                    disabled={submitting}
                    onClick={() => setSelected(tpl.id)}
                    onKeyDown={(e) => onCardKeyDown(e, i)}
                  >
                    <span className="octo-ppt-tpl-thumb" aria-hidden="true">
                      <TemplatePreview id={tpl.id} />
                    </span>
                    <span className="octo-ppt-tpl-text">
                      <span className="octo-ppt-tpl-name">{tpl.name}</span>
                      <span className="octo-ppt-tpl-desc">{tpl.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title (required). */}
          <div className="octo-ppt-create-field">
            <label className="octo-ppt-create-label" htmlFor={titleFieldId}>
              {t('docs.ppt.create.titleLabel')}
            </label>
            <input
              id={titleFieldId}
              type="text"
              className="octo-ppt-create-input"
              value={title}
              maxLength={PPT_TITLE_MAX + 1}
              placeholder={t('docs.ppt.create.titlePlaceholder')}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={tooLong || undefined}
              disabled={submitting}
              onChange={(e) => setTitle(e.target.value)}
            />
            {tooLong && (
              <p className="octo-ppt-create-error" role="alert">
                {t('docs.ppt.create.titleTooLong')}
              </p>
            )}
          </div>

          {error && (
            <p id={errorId} className="octo-ppt-create-error" role="alert">
              {error}
            </p>
          )}

          <footer className="octo-ppt-create-footer">
            {/* Focus order group→title→Create→Cancel: Create precedes Cancel in the DOM (§3). */}
            <button
              type="submit"
              className="octo-tb-btn octo-ppt-create-submit"
              disabled={!canSubmit}
            >
              {submitting ? t('docs.ppt.create.loading') : t('docs.ppt.create.submit')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={submitting}
              onClick={requestClose}
            >
              {t('docs.ppt.create.cancel')}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  )
}
