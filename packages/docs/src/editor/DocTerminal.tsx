// Terminal (dead-end) screen for a document that can't be opened: access revoked, not found,
// locked/archived, session expired, or deleted-under-you. Extracted so BOTH the in-shell editor
// (EditorShell, when the collab bootstrap fails) and the standalone deep-link page
// (StandaloneDocPage, from its GET preflight) render the SAME markup + message for a given kind —
// one source of truth for the boundary states (AC-7 / AC-10 / AC-11 / AC-12).

import type { ReactElement } from 'react'
import { t } from '../octoweb/index.ts'
import type { TerminalState } from '../collab/createCollabEditor.ts'

/** Non-'none' terminal kinds. */
export type TerminalKind = Exclude<TerminalState['kind'], 'none'>

/** i18n key for each terminal kind's user-facing message. */
const MESSAGE_KEYS: Record<TerminalKind, string> = {
  forbidden: 'docs.error.permission.forbidden',
  'not-found': 'docs.error.permission.notFound',
  locked: 'docs.error.permission.locked',
  login: 'docs.error.permission.login',
  deleted: 'docs.error.permission.deleted',
}

/** Resolve the i18n message key for a terminal kind (exported for tests / reuse). */
export function terminalMessageKey(kind: TerminalKind): string {
  return MESSAGE_KEYS[kind]
}

/**
 * The terminal block: a title, the reason message, and — when a handler is provided — a single
 * "back to all documents" control. Nothing else (no Share, no Request access) per the locked
 * scope. `onBack` is optional so the in-shell path (list always resident) can omit it.
 */
export function DocTerminal({
  title,
  kind,
  onBack,
}: {
  title: string
  kind: TerminalKind
  onBack?: () => void
}): ReactElement {
  return (
    <div className="octo-doc octo-terminal">
      {onBack && (
        <button type="button" className="octo-doc-back" onClick={onBack}>
          ← {t('docs.list.back')}
        </button>
      )}
      <h2>{title}</h2>
      <p className="octo-terminal-msg">{t(MESSAGE_KEYS[kind])}</p>
    </div>
  )
}
