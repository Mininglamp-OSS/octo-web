// Recognising a BOT-EDIT safety snapshot in the version list.
//
// WHY A DEDICATED MODULE: "is this row a bot edit?" is the one piece of knowledge the version list,
// the diff entry and their tests all need, and it is a pure function of the wire row — so it lives
// here (unit-testable, single place to change) instead of being inlined in the panel.
//
// HOW A BOT EDIT IS IDENTIFIED (backend contract, verified against octo-docs-backend):
// every successful REST content edit writes a KIND_RESTORE_MARKER (kind=3) version of the PRE-edit
// state in the same transaction as the write, with a FIXED English `name` column which the list
// endpoint serialises as `label` (src/api/routes/versions.ts toItem: `label: v.name`):
//
//   src/api/services/editDocBody.ts     → 'Auto-safety before bot edit'          (rich-text body)
//   src/api/services/editDocSheet.ts    → 'Auto-safety before sheet edit'        (sheet cells)
//
// These rows are NEVER auto-pruned, so a diff baseline can't vanish underneath the UI.
//
// WHY AN EXACT ALLOW-LIST AND NOT A `'Auto-safety before'` PREFIX MATCH — this is the trap:
// a plain human RESTORE also writes a kind=3 row, named 'Auto-safety before restore'
// (src/api/services/restoreVersion.ts). A prefix match would badge every restore as "bot edit".
// Likewise 'Auto-safety before board scene edit' (editBoardScene.ts) is DELIBERATELY excluded: that
// service is also reached from the human file-import route (src/api/routes/import.ts), so the label
// does not prove a bot wrote it. We prefer a false negative (a board bot edit shows no badge) over a
// false positive (a human action labelled as the bot's).
//
// HONEST LIMIT OF THIS SIGNAL: the label proves the write came through the REST content/sheet edit
// API — the bot/agent write path (humans edit over Yjs collab and never mint these rows). It is not
// a `createdBy`-is-a-bot proof; `createdBy` is only used to say WHICH actor, never to decide.

import type { VersionKind } from './api.ts'

/** The exact `label` values a bot/agent content edit stamps on its pre-edit safety snapshot. */
export const BOT_EDIT_SAFETY_LABELS: readonly string[] = [
  'Auto-safety before bot edit',
  'Auto-safety before sheet edit',
]

/** The minimal row shape this check needs (a structural subset of VersionMeta). */
export interface BotEditCandidate {
  kind: VersionKind
  label: string
}

/**
 * True when this version row is the pre-edit snapshot a bot content edit left behind — i.e. the
 * baseline to diff "before the bot edited" against the current body.
 */
export function isBotEditVersion(v: BotEditCandidate): boolean {
  if (v.kind !== 'restore-marker') return false
  return BOT_EDIT_SAFETY_LABELS.includes((v.label ?? '').trim())
}
