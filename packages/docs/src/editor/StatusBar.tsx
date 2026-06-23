import { useSyncExternalStore } from 'react'
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
 * Bottom status bar (toolbar item ⑦): live word + character counts read from the
 * CharacterCount extension's storage (editor.storage.characterCount). View-only — it never
 * mutates the document.
 */
export function StatusBar({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const cc = editor.storage.characterCount as CharacterCountStorage | undefined
  const words = cc?.words?.() ?? 0
  const characters = cc?.characters?.() ?? 0
  return (
    <div className="octo-editor-status" aria-live="polite">
      <span>{t('docs.status.words', { values: { count: words } })}</span>
      <span className="octo-editor-status-sep" aria-hidden="true">·</span>
      <span>{t('docs.status.characters', { values: { count: characters } })}</span>
    </div>
  )
}
