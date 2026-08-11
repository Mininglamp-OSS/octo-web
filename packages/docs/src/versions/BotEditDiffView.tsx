// Bot-edit diff view — "what did the bot just change in this document?"
//
// WHERE THE BASELINE COMES FROM (backend contract, already shipped): every successful
// `PATCH /docs/:docId/content` creates, in the SAME transaction as the write, a
// KIND_RESTORE_MARKER version named 'Auto-safety before bot edit' and returns its seq as
// `newDocVersionSeq`. That version is a pre-edit snapshot and is NEVER auto-pruned, so the diff
// baseline can't vanish underneath this view. The caller hands us that seq as `safetyVersionSeq`.
//
// WHAT IS REUSED (nothing here is re-implemented):
//   • versions/api.ts getVersionState        — loads the baseline version's PM-JSON (+ typed 409s)
//   • versions/diff.ts diffDocs              — the block-level diff (MAX_DIFF_CELLS guard included)
//   • versions/DiffView.tsx                  — the exact diff rows the version panel renders
//   • versions/raceGuard.ts createRaceGuard  — abort + last-write-wins on seq changes
//   • the version panel's existing schema / network / retry copy (docs.version.*)
//
// The "current" side is read from the LIVE editor's JSON — the same read-only seam the version
// panel's compare-with-current uses (`getCurrent: () => editor?.getJSON()`). No new API wrapper,
// and the live editor is NEVER mutated by this component.
//
// UNDO ("撤销本次修改"): restoring the baseline snapshot IS the undo, so it reuses versions/api.ts
// restoreVersion — no new endpoint and no client-side doc write. Two properties of that endpoint
// drive the copy and the gating, and both are quoted from its own contract:
//   • It is FORWARD / non-destructive: the backend auto-saves the current state first, then
//     reconciles in place — so the wording must be "produces new versions", never "roll back to /
//     delete versions". Nothing in the history is removed.
//   • It is ADMIN/owner ONLY (roles.ts canRestoreVersion === canManage). A writer therefore SEES the
//     diff but cannot undo it; see the render block for how that is surfaced.
// Undoing one diff ENTRY is a separate, still-undecided feature (BotEditRevertButton, gated behind
// the optional `onRevertEntry` prop) — do not conflate the two.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { canEdit, canRestoreVersion, type Role } from '../auth/roles.ts'
import { t, type ApiError } from '../octoweb/index.ts'
import {
  getVersionState,
  restoreVersion,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
  type RestoreResult,
} from './api.ts'
import { diffDocs, type DiffEntry, type PMNode } from './diff.ts'
import { DiffView } from './DiffView.tsx'
import { createRaceGuard } from './raceGuard.ts'
import { BotEditRevertButton, type RevertEntryHandler } from './BotEditRevertButton.tsx'

type LoadState = 'loading' | 'ready' | 'error'

/**
 * Classified load failure. `retryable` decides whether a Retry button is offered at all:
 * a missing version (404) and a schema mismatch are PERMANENT — retrying can only fail again,
 * and offering the button teaches the user to bang on a dead control.
 */
interface LoadFailure {
  messageKey: string
  retryable: boolean
}

function classify(e: unknown): LoadFailure {
  if (e instanceof VersionSchemaNewerError) {
    return { messageKey: 'docs.version.previewSchemaNewer', retryable: false }
  }
  if (e instanceof VersionSchemaIncompatibleError) {
    return { messageKey: 'docs.version.previewSchemaIncompatible', retryable: false }
  }
  const status = (e as ApiError).response?.status
  if (status === 404) return { messageKey: 'docs.botDiff.errorMissing', retryable: false }
  // Everything else (network / 5xx / timeout) is treated as transport → retryable.
  return { messageKey: 'docs.version.previewNetworkError', retryable: true }
}

/**
 * Undo-the-whole-edit phases. `done` is TERMINAL for this mounted view: once the restore landed the
 * on-screen diff is stale (the live body has been reconciled back to the baseline via Yjs, but this
 * component's memoized diff was computed from the pre-restore editor JSON), so the diff is replaced
 * by the outcome message rather than left showing changes that no longer exist.
 */
type RevertPhase = 'idle' | 'confirm' | 'running' | 'done'

/**
 * Restore-failure → message key. The distinctions that matter to the user are: you are not allowed
 * (403 — the backend is the authority even though the UI already gates on role), the baseline is
 * gone (404 — nothing to undo to), the format can't be read (409 schema), everything else.
 */
function classifyRevert(e: unknown): string {
  if (e instanceof VersionSchemaNewerError || e instanceof VersionSchemaIncompatibleError) {
    return 'docs.version.errorRestoreIncompatible'
  }
  const status = (e as ApiError).response?.status
  if (status === 403) return 'docs.botDiff.revertAllForbidden'
  if (status === 404) return 'docs.botDiff.revertAllMissing'
  return 'docs.botDiff.revertAllFailed'
}

export interface BotEditDiffViewProps {
  docId: string
  /**
   * The auto-safety version seq returned by the bot's content PATCH (`newDocVersionSeq`) — the
   * pre-edit snapshot the current body is diffed against. Changing it refetches.
   */
  safetyVersionSeq: number
  /** Live editor, READ ONLY: its JSON is the "current" side of the diff. */
  editor?: Editor
  /**
   * Current role. `undefined` means "not known yet" (the collab token hasn't answered), and is
   * treated as NOT-permitted: the per-entry revert affordance is omitted entirely rather than
   * rendered disabled, so we never dangle an edit control at someone who may not hold the right.
   */
  role?: Role
  /**
   * OPTIONAL per-entry "revert this one" intent sink. Omit → no revert button is rendered anywhere
   * and the diff DOM is identical to the version panel's. This component never writes the body
   * itself; the write-back semantics belong to the caller.
   */
  onRevertEntry?: RevertEntryHandler
  /**
   * Called after a SUCCESSFUL "undo the whole edit" restore, with the backend's result. The host uses
   * it to reload the version list (the restore ADDS rows). The view keeps rendering its own outcome
   * message either way — it does not depend on the host reacting.
   */
  onRestored?: (res: RestoreResult) => void
  onClose?: () => void
}

export function BotEditDiffView({
  docId,
  safetyVersionSeq,
  editor,
  role,
  onRevertEntry,
  onRestored,
  onClose,
}: BotEditDiffViewProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [baseline, setBaseline] = useState<PMNode | null>(null)
  const [failure, setFailure] = useState<LoadFailure>({
    messageKey: 'docs.version.previewNetworkError',
    retryable: true,
  })
  // Bumped by Retry to re-run the load effect without changing docId/seq.
  const [attempt, setAttempt] = useState(0)

  // —— "undo the whole edit" (restore the pre-edit snapshot) ——
  const [revertPhase, setRevertPhase] = useState<RevertPhase>('idle')
  const [revertError, setRevertError] = useState<string | null>(null)
  const [revertResult, setRevertResult] = useState<RestoreResult | null>(null)
  // Synchronous re-entry latch: `disabled` does NOT stop a fast double click (React has not
  // re-rendered between the two native events), and this POSTs a state-changing restore.
  const revertInFlight = useRef(false)
  // Liveness flag so a late settle after unmount never calls setState.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const guard = useRef(createRaceGuard())

  useEffect(() => {
    const g = guard.current
    return () => g.abort()
  }, [])

  useEffect(() => {
    const { signal, isCurrent } = guard.current.begin()
    setState('loading')
    setBaseline(null)
    getVersionState(docId, safetyVersionSeq, signal)
      .then((res) => {
        if (!isCurrent()) return // superseded by a newer seq / retry
        setBaseline(res.doc)
        setState('ready')
      })
      .catch((e: unknown) => {
        if (!isCurrent()) return // superseded; swallow the stale error
        setFailure(classify(e))
        setState('error')
      })
  }, [docId, safetyVersionSeq, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  // Current side is read at diff time from the live editor (read-only seam). Recomputed whenever a
  // new baseline lands; the editor reference itself is not reactive, which mirrors how the version
  // panel snapshots "current" when the user opens compare.
  const diff: DiffEntry[] | null = useMemo(() => {
    if (baseline == null) return null
    const current = (editor?.getJSON() as PMNode | undefined) ?? null
    return diffDocs(baseline, current)
  }, [baseline, editor])

  // Revert is a body EDIT, so it is gated by canEdit. Unknown role → not rendered (see prop docs).
  const mayRevert = onRevertEntry != null && role != null && canEdit(role)

  /**
   * Undo the whole edit = restore the pre-edit snapshot through the SHARED restore endpoint
   * (versions/api.ts restoreVersion). No new endpoint, and no client-side document mutation: per that
   * function's contract the backend auto-saves the current state, then reconciles in place and the
   * live editor catches up over normal Yjs sync.
   *
   * PERMISSION: restore is ADMIN/owner only (roles.ts canRestoreVersion === canManage) — a writer must
   * not be able to roll the authoritative body back. Enforced server-side; the UI gate below only
   * avoids putting a control on screen that would 403.
   */
  const mayRevertAll = role != null && canRestoreVersion(role)
  // A KNOWN role that simply lacks the right gets told why. An UNKNOWN role (collab token has not
  // answered yet) gets neither control nor explanation — we do not assert a permission verdict we
  // don't have yet.
  const showRevertAllDenied = role != null && !canRestoreVersion(role)

  const doRevertAll = async () => {
    if (revertInFlight.current) return
    revertInFlight.current = true
    setRevertPhase('running')
    setRevertError(null)
    try {
      const res = await restoreVersion(docId, safetyVersionSeq)
      if (!mounted.current) return
      setRevertResult(res)
      setRevertPhase('done')
      onRestored?.(res)
    } catch (e) {
      if (!mounted.current) return
      setRevertError(classifyRevert(e))
      // Back to the plain button (not the confirm box): the user has already confirmed once, and the
      // error text sits next to the button so a retry is one click.
      setRevertPhase('idle')
    } finally {
      revertInFlight.current = false
    }
  }

  const noChanges = diff != null && diff.every((d) => d.type === 'unchanged')
  // The undo affordance only makes sense once we know there IS something to undo: the baseline must
  // have loaded, and it must actually differ from the current body. (`too-large` counts as a
  // difference — the diff was skipped, not proven empty.)
  const revertAllOffered = state === 'ready' && diff != null && !noChanges && revertPhase !== 'done'

  return (
    <section className="octo-version-panel octo-bot-diff-view">
      <div className="octo-member-row">
        <h4 style={{ flex: 1, margin: 0 }}>{t('docs.botDiff.title')}</h4>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.version.close')}
          </button>
        )}
      </div>

      <p className="octo-bot-diff-baseline">
        {t('docs.botDiff.baseline', { values: { seq: safetyVersionSeq } })}
      </p>

      {state === 'loading' && <p className="octo-loading">{t('docs.botDiff.loading')}</p>}

      {state === 'error' && (
        <div className="octo-version-preview-error">
          <p className="octo-member-error" role="alert">
            {t(failure.messageKey)}
          </p>
          {failure.retryable && (
            <button type="button" className="octo-tb-btn octo-bot-diff-retry" onClick={retry}>
              {t('docs.version.previewRetry')}
            </button>
          )}
        </div>
      )}

      {/* —— Undo the whole edit. Sits ABOVE the diff so it needs no scrolling to reach. —— */}
      {revertAllOffered && mayRevertAll && revertPhase !== 'confirm' && (
        <div className="octo-bot-diff-revert-all">
          <button
            type="button"
            className="octo-tb-btn octo-bot-diff-revert-all-btn"
            disabled={revertPhase === 'running'}
            onClick={() => setRevertPhase('confirm')}
          >
            {revertPhase === 'running' ? t('docs.botDiff.revertingAll') : t('docs.botDiff.revertAll')}
          </button>
        </div>
      )}

      {/* Second confirmation: this overwrites the CURRENT body, so it is never one click. Rendered
          inline (not as another overlay) because this view is itself already inside the panel's
          modal, and stacking overlays makes Esc/overlay-close ambiguous. */}
      {revertAllOffered && mayRevertAll && revertPhase === 'confirm' && (
        <div className="octo-version-confirm octo-bot-diff-confirm" role="group" aria-label={t('docs.botDiff.revertAll')}>
          <p>{t('docs.botDiff.revertAllConfirmTitle')}</p>
          <p className="octo-version-confirm-detail">
            {t('docs.botDiff.revertAllConfirmDetail', { values: { seq: safetyVersionSeq } })}
          </p>
          <div className="octo-member-row">
            <button
              type="button"
              className="octo-tb-btn octo-bot-diff-revert-all-confirm"
              onClick={() => void doRevertAll()}
            >
              {t('docs.botDiff.revertAllConfirm')}
            </button>
            <button type="button" className="octo-tb-btn" onClick={() => setRevertPhase('idle')}>
              {t('docs.version.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Role is known and lacks the right: explain instead of silently hiding. We do NOT render a
          disabled button — the codebase's convention is to never dangle an edit control at someone
          who cannot use it — but the product complaint here was "no undo", so silence would just
          look like the feature is missing. */}
      {revertAllOffered && showRevertAllDenied && (
        <p className="octo-bot-diff-revert-hint">{t('docs.botDiff.revertAllNeedsAdmin')}</p>
      )}

      {revertError && (
        <p className="octo-member-error octo-bot-diff-revert-all-error" role="alert">
          {t(revertError)}
        </p>
      )}

      {revertPhase === 'done' && revertResult && (
        <p className="octo-version-notice octo-bot-diff-reverted" role="status">
          {t('docs.botDiff.revertAllDone', {
            values: { from: revertResult.restoredFrom, seq: revertResult.newDocVersionSeq },
          })}
        </p>
      )}

      {/* An identical baseline/current pair must say so explicitly — never an empty box. */}
      {state === 'ready' && diff != null && noChanges && revertPhase !== 'done' && (
        <p className="octo-version-empty octo-bot-diff-empty">{t('docs.botDiff.noChanges')}</p>
      )}

      {/* Hidden once the undo landed: the memoized diff was computed from the PRE-restore editor
          JSON, so leaving it up would show changes that no longer exist. */}
      {state === 'ready' && diff != null && !noChanges && revertPhase !== 'done' && (
        <DiffView
          diff={diff}
          // undefined (NOT a no-op function) when revert is off, so DiffView emits zero extra DOM.
          renderEntryAction={
            mayRevert && onRevertEntry
              ? (entry, index) => (
                  <BotEditRevertButton
                    key={`revert-${index}`}
                    entry={entry}
                    index={index}
                    onRevert={onRevertEntry}
                  />
                )
              : undefined
          }
        />
      )}
    </section>
  )
}
