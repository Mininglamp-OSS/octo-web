// Math insert flow (C5, SCHEMA-SPEC §14). Prompts the user for the LaTeX instead of inserting the
// old hardcoded 'a^2 + b^2 = c^2'. Used by the slash command (which has no React popover); the
// toolbar uses an inline input popover that calls insertInlineMath / insertBlockMath directly.
//
// Empty / cancelled input inserts nothing (the math commands themselves no-op on empty latex). When
// a slash `range` is supplied it is removed either way (so the typed "/math" text never lingers).

import type { Editor, Range } from '@tiptap/core'
import { t } from '../octoweb/index.ts'

export function promptAndInsertMath(editor: Editor, kind: 'inline' | 'block', range?: Range): void {
  const raw =
    typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt(t('docs.toolbar.mathPrompt'))
      : null
  const latex = raw?.trim()
  const chain = editor.chain().focus()
  if (range) chain.deleteRange(range)
  if (!latex) {
    chain.run() // remove the slash range (if any); insert nothing
    return
  }
  if (kind === 'inline') chain.insertInlineMath({ latex }).run()
  else chain.insertBlockMath({ latex }).run()
}
