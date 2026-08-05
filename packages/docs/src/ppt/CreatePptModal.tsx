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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  /**
   * Called with the backend-returned editor route after a successful create. NOT called on cancel.
   * Returns `false` when the caller REFUSED to navigate (e.g. the route failed the open-redirect
   * guard, P1-1); the modal then surfaces an inline error and stays open/retriable instead of
   * silently soft-locking. `void`/`true` mean the caller took over navigation and the modal unmounts.
   */
  onCreated(editorUrl: string): boolean | void
  /**
   * The PERSISTENT element that opened the picker (the DocsHome "new" caret button), to restore focus
   * to on close. Supplied explicitly because the picker is launched from a caret dropdown MENU ITEM
   * that unmounts the instant it is clicked — so `document.activeElement` at open time is already a
   * detached node / `<body>` and cannot be a reliable restore target (R2-F1). The caret persists across
   * the menu open/close, so restoring to it lands focus correctly. Optional: falls back to
   * `document.activeElement` when omitted (e.g. programmatic opens in tests).
   */
  triggerRef?: React.RefObject<HTMLElement | null>
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
  triggerRef,
}: CreatePptModalProps): React.ReactElement | null {
  const [selected, setSelected] = useState<PptTemplateId>(DEFAULT_PPT_TEMPLATE)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  // The element focused before the modal opened, restored on close (design §3 focus trap + restore).
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // Idempotency key for the CURRENT submit session. It must be REUSED across an identical retry (so
  // a lost-response retry dedups to the same deck, hard metric #3) but RE-MINTED whenever the payload
  // (title/template) changes — otherwise a content-changed resubmit reuses the key, the backend
  // dedups on it, and the user gets the FIRST (stale-title) deck back (P1-2). Minted by the
  // payload-keyed effect below, not just on open.
  const idempotencyKeyRef = useRef<string>('')
  // Synchronous double-submit latch: flipped true the instant a create starts, BEFORE React
  // re-renders the disabled button. Two clicks in the same tick can both observe `submitting`
  // state as false, so the state-derived `disabled` alone can leak a second HTTP request; this ref
  // closes that window (belt-and-suspenders over idempotency-key reuse). Reset on each open/failure.
  const submittingRef = useRef(false)
  // Generation token for the in-flight submit (P1-3). The open/space reset effect bumps this, so if
  // the user switches space (or the modal reopens) mid-await, the submit's captured token goes stale
  // and its late resolve must NOT navigate to the wrong-space deck. Same idiom as useDocComments'
  // reqRef / SummaryListPage's loadDataSeq generation guards.
  const submitSeqRef = useRef(0)

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

  // Reset the draft whenever the modal opens or the space changes; remember what to restore focus to.
  // Bumping submitSeqRef here invalidates any in-flight submit's generation token, so a create that
  // was fired before a space switch cannot navigate after it resolves (P1-3).
  useEffect(() => {
    if (!open) return
    setSelected(DEFAULT_PPT_TEMPLATE)
    setTitle('')
    setSubmitting(false)
    setError(null)
    submittingRef.current = false
    submitSeqRef.current += 1
    // Capture the restore target. Prefer the caller-supplied PERSISTENT trigger (the caret button that
    // opened the picker) over document.activeElement: the picker is launched from a caret DROPDOWN menu
    // item that unmounts the instant it is clicked (the menu closes as it fires onCreatePpt), so by the
    // time this open effect runs the previously-focused element is a DETACHED menu item and
    // document.activeElement has already fallen back to <body>. Restoring to either silently no-ops and
    // focus is stranded on <body> (the R2-F1 defect). The caret persists across the menu open/close, so
    // it is the correct, still-connected restore target. Fall back to document.activeElement only when
    // no trigger is supplied (e.g. programmatic opens in tests).
    const trigger = triggerRef?.current
    restoreFocusRef.current =
      trigger && trigger.isConnected
        ? trigger
        : typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
  }, [open, spaceId, triggerRef])

  // Mint the idempotency key for the current payload (P1-2). Keyed on the payload (title + template)
  // as well as open/space so the key is STABLE across an identical retry — a plain retry re-runs
  // onSubmit without changing title/selected, so no new key is minted and the backend dedups to the
  // same deck — but a FRESH key is minted the moment the user edits the title or picks another
  // template, so a content-changed resubmit is a distinct create (never a stale-title dedup).
  useEffect(() => {
    if (!open) return
    idempotencyKeyRef.current = newIdempotencyKey()
  }, [open, spaceId, title, selected])

  // Restore focus to the element that had it before the modal opened (the trigger caret).
  // This MUST run AFTER the native <dialog> has finished closing. On the Esc/close route the
  // browser moves focus to <body> asynchronously relative to our React handlers, so a synchronous
  // focus() inside the cancel/keydown handler is immediately overwritten and focus ends up on
  // <body> (the observed R2-F1 defect). Deferring to the next animation frame (with a timeout
  // fallback) lets us run after the browser's own focus move and reliably land on the trigger
  // (design §3 focus restore, PPT-UI-001).
  const scheduleFocusRestore = useCallback(() => {
    const run = () => {
      // Prefer the LIVE persistent trigger (the caret) — it survives the menu close, whereas the element
      // captured on open may have detached. Only reclaim focus if the dialog close dropped it to <body>
      // (or nowhere); never yank it away if the app has meanwhile placed it somewhere deliberate. Never
      // focus a detached node: el.focus() on a node not in the document silently no-ops and leaves focus
      // on <body> (the observed R2-F1 failure), so guard on isConnected.
      const target = triggerRef?.current ?? restoreFocusRef.current
      if (!target || target.isConnected === false) return
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (!active || active === document.body) target.focus?.()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 0)
  }, [triggerRef])

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
      scheduleFocusRestore()
    }
  }, [open, scheduleFocusRestore])

  if (!open) return null

  const trimmed = title.trim()
  const tooLong = title.length > PPT_TITLE_MAX
  const canSubmit = trimmed.length > 0 && !tooLong && !submitting

  // Cancel/Esc/overlay dismissal — blocked while a create is in flight so the request can't be
  // orphaned mid-submit (the retry would otherwise mint under a fresh key on reopen). Focus is
  // restored to the trigger on a post-close animation frame (see scheduleFocusRestore): the native
  // dialog moves focus to BODY on the Esc/close path in real browsers, so a synchronous restore
  // here would be overwritten (design §3 focus restore, PPT-UI-001).
  const requestClose = () => {
    if (submitting) return
    scheduleFocusRestore()
    onClose()
  }

  // Focus trap (design §3, PPT-UI-001): keep Tab/Shift+Tab cycling within the dialog. Only the
  // boundary transitions are intercepted — the browser handles intermediate Tabs natively. The
  // tabbable set follows the roving radiogroup (only the selected card is tabbable) plus the title
  // input and the enabled footer buttons, in DOM order: radio → title → Create → Cancel.
  const onDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const tabbable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.tabIndex !== -1)
    if (tabbable.length === 0) return
    const first = tabbable[0]
    const last = tabbable[tabbable.length - 1]
    const active = document.activeElement
    const inside = active instanceof HTMLElement && dialog.contains(active)
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      e.preventDefault()
      first.focus()
    }
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
    if (!canSubmit || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    // Capture the submit generation (P1-3). The open/space reset effect bumps submitSeqRef, so if the
    // user switches space (or the modal resets) mid-await, this captured token goes stale.
    const token = submitSeqRef.current
    try {
      const result = await createPptDoc({
        title: trimmed,
        templateId: selected,
        folderId,
        idempotencyKey: idempotencyKeyRef.current,
      })
      // Cross-space late-resolve guard (P1-3): if the space changed (or the modal reset) during the
      // await, this create belongs to a stale context — do NOT navigate to its wrong-space deck.
      if (submitSeqRef.current !== token) return
      // Trust the backend route ONLY — no frontend fallback (preserves R1 no-fallthrough). The caller
      // gates the route through the open-redirect guard; a `false` return means it REFUSED to navigate
      // (unsafe route, P1-1) — surface an inline error and keep the modal open/retriable instead of
      // soft-locking on a dead "success".
      if (onCreated(result.editorUrl) === false) {
        setError(t('docs.ppt.create.error'))
        submittingRef.current = false
        setSubmitting(false)
      }
    } catch (err) {
      // A superseded submit (space switched mid-await) must not clobber the fresh draft with its late
      // error either — bail on a stale generation (P1-3).
      if (submitSeqRef.current !== token) return
      const status = (err as { response?: { status?: number } })?.response?.status
      // 400 → inline validation error, modal stays open, no navigation (hard metric #2).
      // Everything else (401/409/5xx/missing editorUrl/network) → generic error, modal stays open
      // and retriable; the same idempotency key is reused so a retry never duplicates a deck.
      setError(status === 400 ? t('docs.ppt.create.validationError') : t('docs.ppt.create.error'))
      submittingRef.current = false
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
        onKeyDown={onDialogKeyDown}
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
