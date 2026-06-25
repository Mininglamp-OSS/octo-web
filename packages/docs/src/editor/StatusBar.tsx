import { useSyncExternalStore, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { t } from '../octoweb/index.ts'

/** Re-render on every editor transaction so the live counts stay current. */
function useEditorTick(editor: Editor): void {
  useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      return () => {
        editor.off('transaction', cb)
      }
    },
    () => editor.state.doc.content.size,
  )
}

interface CharacterCountStorage {
  words: () => number
  characters: () => number
}

/**
 * Minimal structural view of the collab provider's sync surface (HocuspocusProvider). The
 * indicator only needs to observe sync state — it never sends, mutates, or polls. Kept
 * structural so tests can pass a tiny event-emitter stub.
 */
export interface SyncProvider {
  /** True while local edits have not yet been acknowledged by the server. */
  hasUnsyncedChanges: boolean
  on(event: string, fn: (...args: unknown[]) => void): void
  off(event: string, fn: (...args: unknown[]) => void): void
}

/** Display-only autosave state. `saved` carries the HH:mm it was last synced. */
type SaveState = 'idle' | 'pending' | 'saved'

// How long the "已自动保存 · HH:mm" stamp stays before settling to the quiet idle label.
const SAVED_STAMP_MS = 2500

function nowHHmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Autosave indicator (frontend-local). Derives state purely from local signals — never
 * triggers a save and never claims a server version was created:
 *   - `editor.on('update')` and the provider's `unsyncedChanges` (count > 0) → "编辑中…" (pending)
 *   - the provider's `synced` / `unsyncedChanges` (count 0) → "已自动保存 · HH:mm" (saved),
 *     settling to the quiet "已自动保存" idle label after a short delay.
 *
 * The label means "your edits are synced to the server" — the precondition for the backend's
 * autonomous KIND_AUTO snapshot. Zero backend dependency, zero polling, no new signal channel.
 */
export function AutosaveIndicator({ editor, provider }: { editor: Editor; provider?: SyncProvider }) {
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  // True once any sync has completed, so the resting idle label is "已自动保存" rather than blank.
  const [everSaved, setEverSaved] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearSettle = () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current)
        settleTimer.current = null
      }
    }
    const markPending = () => {
      clearSettle()
      setState('pending')
    }
    const markSaved = () => {
      clearSettle()
      setEverSaved(true)
      setSavedAt(nowHHmm())
      setState('saved')
      settleTimer.current = setTimeout(() => setState('idle'), SAVED_STAMP_MS)
    }

    // Local edit → pending immediately (before the provider registers the unsynced change).
    const onUpdate = () => markPending()
    editor.on('update', onUpdate)

    // Provider sync transitions: count > 0 → pending, count 0 → saved. `synced` covers the
    // initial handshake when there is nothing to flush.
    const onUnsynced = (count: unknown) => {
      if (typeof count === 'number' && count > 0) markPending()
      else markSaved()
    }
    const onSynced = () => {
      if (!provider?.hasUnsyncedChanges) markSaved()
    }
    provider?.on('unsyncedChanges', onUnsynced)
    provider?.on('synced', onSynced)

    return () => {
      clearSettle()
      editor.off('update', onUpdate)
      provider?.off('unsyncedChanges', onUnsynced)
      provider?.off('synced', onSynced)
    }
  }, [editor, provider])

  let label = ''
  if (state === 'pending') label = t('docs.status.editing')
  else if (state === 'saved') label = t('docs.status.savedAt', { values: { time: savedAt ?? nowHHmm() } })
  else if (everSaved) label = t('docs.status.saved')

  return (
    <span className="octo-editor-autosave" aria-live="polite">
      {label}
    </span>
  )
}

/**
 * Bottom status bar (toolbar item ⑦): live word + character counts read from the
 * CharacterCount extension's storage (editor.storage.characterCount), plus a right-aligned
 * autosave indicator. View-only — it never mutates the document.
 */
export function StatusBar({ editor, provider }: { editor: Editor; provider?: SyncProvider }) {
  useEditorTick(editor)
  const cc = editor.storage.characterCount as CharacterCountStorage | undefined
  const words = cc?.words?.() ?? 0
  const characters = cc?.characters?.() ?? 0
  return (
    <div className="octo-editor-status" aria-live="polite">
      <span>{t('docs.status.words', { values: { count: words } })}</span>
      <span className="octo-editor-status-sep" aria-hidden="true">·</span>
      <span>{t('docs.status.characters', { values: { count: characters } })}</span>
      <AutosaveIndicator editor={editor} provider={provider} />
    </div>
  )
}
