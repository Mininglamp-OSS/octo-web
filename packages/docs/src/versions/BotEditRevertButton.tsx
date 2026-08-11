// "Revert this one" affordance for a single bot-edit diff entry (产品: "先配上吧，以后删也好删").
//
// DELIBERATELY ISOLATED so it is trivial to remove: it is its own file, it is reached ONLY through
// <BotEditDiffView onRevertEntry=…>, and it renders NOTHING unless that optional prop is supplied.
// Deleting the feature = delete this file + the `onRevertEntry` prop; the diff DOM returns to
// exactly what it is today (see DiffView's `renderEntryAction` contract).
//
// This component NEVER writes to the document. The write-back semantics for "undo one block" are
// still undecided by product, so all it does is hand the intent (`entry`, `index`) to the caller and
// own the resulting UI state: in-flight (disabled + loading label), failed (error text + retry).
//
// Double-click hardening: `disabled` alone does NOT stop a fast double click, because React has not
// re-rendered the button between the two native click events. A SYNCHRONOUS ref latch is what
// actually guarantees the callback fires once per completed attempt.

import { useEffect, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import type { DiffEntry } from './diff.ts'

export type RevertEntryHandler = (entry: DiffEntry, index: number) => void | Promise<void>

export function BotEditRevertButton({
  entry,
  index,
  onRevert,
}: {
  entry: DiffEntry
  index: number
  onRevert: RevertEntryHandler
}) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  // Synchronous re-entry latch (see header note) — the real double-click guard.
  const inFlight = useRef(false)
  // Liveness flag so a late settle after unmount never calls setState.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const click = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setFailed(false)
    try {
      await onRevert(entry, index)
      if (mounted.current) setFailed(false)
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }

  return (
    <span className="octo-diff-entry-action">
      <button
        type="button"
        className="octo-tb-btn octo-diff-revert-btn"
        disabled={pending}
        onClick={() => void click()}
      >
        {pending
          ? t('docs.botDiff.reverting')
          : failed
            ? t('docs.botDiff.revertRetry')
            : t('docs.botDiff.revert')}
      </button>
      {failed && (
        <span className="octo-member-error octo-diff-revert-error" role="alert">
          {t('docs.botDiff.revertFailed')}
        </span>
      )}
    </span>
  )
}
