import { useState, useRef, useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../octoweb/index.ts'
import { CLI_REFERENCE_URL } from '../config.ts'

/**
 * "?" agent CLI onboarding help (Mininglamp-OSS/octo-docs-backend#125).
 *
 * Root cause: the docs list changed from a global view to "owned / recently viewed by the current
 * user and their agents", so the old CLI onboarding entry stopped being discoverable (a brand-new
 * agent owns/has-viewed nothing). Rather than reintroduce a list entry, this is a permanent "?"
 * button in the Docs header — always visible, independent of any list/ownership/recent state.
 *
 * Clicking it opens a self-contained dialog whose core is a COPYABLE self-bind prompt: the user
 * pastes it to their bot, and the bot — which can read its OWN Octo token from its config — installs
 * octo-cli, configures itself, and starts using Octo Docs (read / create / update / collaborate).
 * No user-entered secrets, no route/deep-link. Version-sensitive command details are not duplicated
 * here; the dialog links to the canonical CLI reference (CLI_REFERENCE_URL).
 */
export function OnboardingHelp(): ReactElement {
  // useI18n() (not the one-shot t()) subscribes this component to the host's locale context, so the
  // button/dialog copy updates immediately on a runtime zh/en switch (octoweb/index.ts contract).
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Clipboard API unavailable/denied: show a manual-copy hint instead of a silently dead button.
  const [manualCopy, setManualCopy] = useState(false)
  const prompt = t('docs.onboarding.prompt')
  // Focus management: remember the trigger so focus returns to it when the dialog closes, and move
  // focus into the dialog on open (role="dialog" + aria-modal="true" imply both).
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // Last focusable inside the dialog (the reference link) — the other end of the Tab cycle.
  const lastFocusRef = useRef<HTMLAnchorElement | null>(null)
  // The dialog card itself: the Tab trap tests containment against it (see the keydown handler), so
  // focus that has fallen out of the cycle onto <body> is pulled back in rather than escaping.
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // The read-only prompt textarea: focused (it self-selects) when the clipboard path is unavailable.
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  // The portaled overlay root. The inert effect must skip the branch of <body> that contains the
  // dialog itself — marking our own subtree inert would disable the dialog we just opened.
  const portalHostRef = useRef<HTMLDivElement | null>(null)
  // Hold the "copied" reset timer so a second click within the window re-arms it instead of letting
  // the first timer fire early (and so it is cleared on unmount rather than leaking a setState).
  const copiedTimer = useRef<number | null>(null)
  // Latest close() for the document-level keydown listener. A ref (not a dep) keeps the listener
  // registered once per open instead of re-subscribing on every render, while Escape still runs the
  // current teardown — close() is declared below, after the state it touches.
  const closeFnRef = useRef<() => void>(() => {})
  // Un-inerts the background elements the open-effect marked. close() must call this BEFORE it
  // restores focus to the trigger, because the trigger lives inside one of those elements and
  // .focus() is a no-op inside an inert subtree. Idempotent: it drains the list it restores.
  const restoreBackgroundRef = useRef<() => void>(() => {})
  // Session epoch for async clipboard writes. close() bumps it, so a write that resolves (or
  // rejects) after the dialog closed can tell it is stale and refuse to touch state.
  const copyEpoch = useRef(0)

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    [],
  )

  // Make `aria-modal="true"` true instead of merely asserted. Trapping Tab is not enough: the dialog
  // is portaled to <body>, so it is a SIBLING of the Docs list, and screen-reader virtual navigation
  // or a programmatic .focus() can still reach the list behind the scrim.
  // Mark every other body child inert while open. `inert` also removes them from the a11y tree in
  // supporting engines; `aria-hidden` is set alongside for engines that do not implement it yet.
  // Only elements we actually changed are restored, so we never clobber a pre-existing inert/hidden.
  // The restore is exposed through a ref because close() must un-inert the background BEFORE it
  // focuses the trigger: the trigger is inside one of these elements, and in engines that implement
  // `inert`, .focus() on a node in an inert subtree does nothing, which would drop keyboard users on
  // <body> — exactly the regression close() exists to prevent. Cleanup still runs the same restore
  // so an unmount while open (or any path that bypasses close()) cannot leave the page inert.
  useEffect(() => {
    if (!open) {
      restoreBackgroundRef.current = () => {}
      return
    }
    const dialogHost = portalHostRef.current
    let touched: HTMLElement[] = []
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue
      if (child === dialogHost || child.contains(dialogHost)) continue
      if (child.hasAttribute('inert') || child.getAttribute('aria-hidden') === 'true') continue
      child.setAttribute('inert', '')
      child.setAttribute('aria-hidden', 'true')
      touched.push(child)
    }
    // Draining `touched` makes this idempotent: close() calls it, then the effect cleanup calls it
    // again on the resulting `open=false` commit, and the second call is a no-op.
    const restore = () => {
      for (const child of touched) {
        child.removeAttribute('inert')
        child.removeAttribute('aria-hidden')
      }
      touched = []
    }
    restoreBackgroundRef.current = restore
    return () => {
      restore()
      restoreBackgroundRef.current = () => {}
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Consume it: the editor subtree registers several document-level Escape handlers
        // (TableControls / Toolbar / DocMoreMenu / ConfirmModal). They are each gated on their own
        // open state today, but a modal that claims the key contract must actually own the key.
        e.stopPropagation()
        // Go through close() rather than setOpen(false) so Escape gets the SAME teardown as the ×
        // and backdrop paths: focus restored to the trigger (otherwise focus is left on a removed
        // node and keyboard users land on <body>) and the copy feedback + its timer cleared.
        closeFnRef.current()
        return
      }
      // The background is marked inert while open (see the `open` effect below), so Tab must not walk
      // out of the dialog into the list controls behind the scrim either.
      if (e.key === 'Tab') {
        const first = closeRef.current
        const last = lastFocusRef.current
        if (!first || !last) return
        const active = document.activeElement
        // Containment-based, NOT endpoint-based: clicking a non-focusable part of the dialog (title,
        // intro text, padding) drops focus to <body>, which matches neither endpoint — an
        // endpoint-only trap would then let the native sequence resume from the top of the document
        // and walk into the list controls *behind* the scrim (the dialog is the last body child).
        if (!dialogRef.current?.contains(active)) {
          e.preventDefault()
          e.stopPropagation()
          first.focus()
          return
        }
        if (e.shiftKey && active === first) {
          e.preventDefault()
          e.stopPropagation()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          e.stopPropagation()
          first.focus()
        }
      }
    }
    // Capture phase: the dialog is portaled to <body>, so a bubble-phase listener would let an outer
    // widget see Escape/Tab first. Scope of what this actually buys, precisely:
    // capture + stopPropagation suppresses the editor's BUBBLE-phase document handlers
    // (ConfirmModal / TableControls / DocMoreMenu / Toolbar), which is the set that matters here.
    // It does NOT make this modal globally exclusive: other CAPTURE-phase document listeners in the
    // editor (sheetMention / TableReorderHandle / TableRowHeight) would still fire — that would need
    // stopImmediatePropagation() — and a window-capture listener runs earlier still. Each of those
    // three is installed only for the duration of its own interaction and so is never registered
    // while this dialog is open, which is why the weaker guarantee is sufficient and we do not reach
    // for stopImmediatePropagation (it would also silence unrelated same-node listeners).
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const close = () => {
    setOpen(false)
    // Invalidate any in-flight clipboard write from this session: promises cannot be cancelled, so a
    // late resolve/reject must not re-arm "Copied", start a timer, or focus a textarea after close.
    copyEpoch.current += 1
    // Clear the copy feedback AND its pending timer: otherwise copying, closing, and reopening
    // within the 2s window shows "Copied" for a copy that did not happen in this session, and the
    // surviving timer later flips the label mid-session.
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
    setCopied(false)
    setManualCopy(false)
    // Un-inert the background BEFORE focusing. The trigger is rendered inside one of the body
    // children the open-effect marked `inert`, and the effect's own cleanup does not run until the
    // `open=false` commit lands — i.e. AFTER this function returns. Focusing first would therefore
    // call .focus() on a node still inside an inert subtree, which engines that implement `inert`
    // ignore, leaving keyboard users on <body>. jsdom does not implement that suppression, so no
    // unit test can observe the ordering directly; the coverage asserts the trigger has no `[inert]`
    // ancestor at the instant focus is restored, which is the property that makes the focus stick.
    restoreBackgroundRef.current()
    // Return focus to the "?" trigger so keyboard users are not dropped at the top of the document.
    triggerRef.current?.focus()
  }
  // Keep the ref current for the document-level keydown listener. Assigning during render is the
  // pattern React warns against (and lint rules flag), so it happens in an effect instead.
  // The effect runs before any user keystroke can reach the listener, so Escape always sees
  // the current close().
  useEffect(() => {
    closeFnRef.current = close
  })

  const copy = async () => {
    // A clipboard write is async but the dialog can close under it, and a promise cannot be
    // cancelled. Stamp the attempt with the current session epoch (bumped on every close) and drop
    // any resolve/reject that lands after it: otherwise a slow write would flip "Copied" on for a
    // copy the user never sees, arm a fresh 2s timer past close(), or focus a textarea belonging to
    // a newly mounted dialog.
    const epoch = copyEpoch.current
    const stale = () => copyEpoch.current !== epoch
    // `navigator.clipboard?.writeText(...)` RESOLVES to undefined when the Clipboard API is absent
    // (insecure context / older browser), so awaiting it would report a successful copy that never
    // happened. Check for the API first and only flag "copied" when a real write resolved.
    const writeText = navigator.clipboard?.writeText
    if (typeof writeText !== 'function') {
      // Do NOT claim success — but do not leave a dead control either. Surface the manual fallback
      // and focus the textarea, which self-selects, so the user is one Ctrl/Cmd+C from the prompt.
      setManualCopy(true)
      promptRef.current?.focus()
      return
    }
    try {
      await navigator.clipboard.writeText(prompt)
      if (stale()) return
      setCopied(true)
      setManualCopy(false)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => {
        copiedTimer.current = null
        setCopied(false)
      }, 2000)
    } catch {
      // Write rejected (permission denied): the prompt is still visible and selectable in the
      // dialog, so the user can copy it manually. Never claim success — show the manual hint.
      if (stale()) return
      setManualCopy(true)
      promptRef.current?.focus()
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="octo-docs-help-btn"
        data-testid="onboarding-help-btn"
        aria-label={t('docs.onboarding.helpTitle')}
        title={t('docs.onboarding.helpTitle')}
        onClick={() => setOpen(true)}
      >
        {/* Real SVG icon (UI-SPEC: never use emoji / Unicode glyphs as functional icons). */}
        <svg
          className="octo-docs-help-glyph"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.4 9.2a2.6 2.6 0 1 1 3.6 2.5c-.8.4-1.3 1-1.3 1.9v.4" />
          <line x1="12" y1="17.2" x2="12" y2="17.2" />
        </svg>
      </button>
      {open &&
        /* Portal to <body>: `.octo-docs-list` sets `container-type: inline-size` (styles.css), which
           applies layout containment and therefore becomes the containing block for `position: fixed`
           descendants AND scopes their z-index. Rendered inline, this "modal" would resolve against
           the list's padding box — in split view a ~280px sidebar — and be clipped by that pane's
           `overflow-y: auto`. Same reason `PortalMenu.tsx` exists. */
        createPortal(
          <div
            ref={portalHostRef}
            className="octo-docs-help-overlay"
            data-testid="onboarding-help-overlay"
            role="presentation"
            /* Dismiss only when the press LANDS on the scrim itself. `onClick` on the overlay is not
               enough: a drag that starts in the textarea and ends on the scrim delivers `click` to
               the nearest common ancestor (this overlay), so a descendant `stopPropagation` never
               runs and the dialog would close, discarding the user's selection. Matching
               ConfirmModal.tsx, dismissal is keyed on mousedown target identity. */
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close()
            }}
          >
          <div
            ref={dialogRef}
            className="octo-docs-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.onboarding.dialogTitle')}
          >
            <div className="octo-docs-help-dialog-header">
              <h2 className="octo-docs-help-dialog-title">{t('docs.onboarding.dialogTitle')}</h2>
              <button
                type="button"
                ref={closeRef}
                className="octo-docs-help-dialog-close"
                aria-label={t('docs.onboarding.close')}
                onClick={close}
              >
                <svg
                  className="octo-docs-help-glyph"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <p className="octo-docs-help-dialog-intro">{t('docs.onboarding.dialogIntro')}</p>
            <textarea
              className="octo-docs-help-prompt"
              data-testid="onboarding-help-prompt"
              ref={promptRef}
              readOnly
              value={prompt}
              rows={12}
              onFocus={(e) => e.currentTarget.select()}
            />
            {/* Not an error state — the prompt is intact and selected; this only tells the user the
                browser refused programmatic clipboard access (insecure context / denied permission)
                so the copy has to be finished by hand. `role="status"` announces it politely.
                The region is rendered UNCONDITIONALLY and only its TEXT is toggled: a live region
                inserted at the same instant as its text is announced inconsistently across screen
                readers, so it must already exist in the a11y tree before the content arrives.
                It must NOT use `hidden` for that: `hidden` removes the node from the a11y tree, so
                while inactive it would not be a present live region at all — the same defect as
                conditional mounting, one step later. It stays mounted and visually hidden via an
                sr-only clip while empty, and becomes visible text once there is something to say. */}
            <p
              className={`octo-docs-help-manual-hint${
                manualCopy ? '' : ' octo-docs-help-manual-hint-idle'
              }`}
              data-testid="onboarding-help-manual-hint"
              role="status"
              aria-live="polite"
            >
              {manualCopy ? t('docs.onboarding.copyManualHint') : ''}
            </p>
            <div className="octo-docs-help-dialog-actions">
              <button
                type="button"
                className="octo-docs-help-copy"
                data-testid="onboarding-help-copy"
                onClick={() => void copy()}
              >
                {copied ? t('docs.onboarding.copied') : t('docs.onboarding.copy')}
              </button>
              <a
                className="octo-docs-help-reference"
                data-testid="onboarding-help-reference"
                ref={lastFocusRef}
                href={CLI_REFERENCE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('docs.onboarding.referenceLinkLabel')}
              </a>
            </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
