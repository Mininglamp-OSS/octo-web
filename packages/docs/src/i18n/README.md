# `@octo/docs` i18n

The `docs` namespace is registered in `DocsModule.init()`
(`packages/docs/src/module.tsx`) via `i18n.registerNamespace("docs", { "zh-CN", "en-US" })`,
matching the pattern used by `dmworktodo`. Locale files live here:

- `zh-CN.json` — Chinese (default app locale)
- `en-US.json` — English

Both files MUST keep an identical key shape. `i18n.test.ts` enforces this parity.

## Key groups

| Group                    | Covers                                                    |
| ------------------------ | --------------------------------------------------------- |
| `docs.toolbar.*`         | Fixed top-toolbar button tooltips + header buttons        |
| `docs.slash.*`           | Slash-command menu item titles / groups                   |
| `docs.version.*`         | Version-history drawer (chrome, badges, confirms, errors) |
| `docs.comment.*`         | Comment panel chrome                                       |
| `docs.invite.*`          | Invite-accept page                                        |
| `docs.role.*`            | Role display labels (reader / writer / admin)             |
| `docs.state.*`           | Loading / empty / error / syncing states                  |
| `docs.error.permission.*`| Terminal access errors (forbidden / not-found / …)        |

## Wired this pass (phase 3, focused first pass)

The most visible "chrome" strings are now driven by `t()`:

- `editor/EditorShell.tsx` — loading state, terminal permission errors, History /
  Comments / Members header buttons + tooltips.
- `editor/Toolbar.tsx` — toolbar button tooltips and the link input placeholder / Set.
- `versions/VersionPanel.tsx` — all panel chrome (title, save/restore/rename/delete,
  badges, confirm dialogs, notices, errors, empty/loading states).
- `invite/InviteAcceptPage.tsx` — all states + role label.
- `module.tsx` — Suspense fallback (`docs.state.loading`).

## TODO — still hardcoded (follow-up pass)

These components still contain hardcoded English UI strings and should be migrated to
`t()` in a follow-up. Keys for them already exist (or are noted) so the migration is
string-swap only:

- [ ] `editor/SlashCommand.ts` — `SLASH_ITEMS` titles + groups ("Heading 1", "Basic", …).
      Keys ready under `docs.slash.*`. Needs the item list to read titles via `t()` at
      render time (currently baked into the static `SLASH_ITEMS` array).
- [ ] `comments/CommentPanel.tsx` — "Comments", "Loading comments…", "Reply…", "Resolve",
      "Reopen", "Delete this comment?". Keys ready under `docs.comment.*`.
- [ ] `comments/CommentBubble.tsx` — comment-create affordance strings.
- [ ] `members/MemberPanel.tsx` — "Members", "Loading members…", "octo user id"
      placeholder, and the add/remove/role error toasts ("Failed to add member.", …).
      (No `docs.member.*` group yet — add one when migrating.)
- [ ] `invite/InvitePanel.tsx` — "Invite links" and link-management chrome.
      (No full `docs.invite.panel.*` group yet — extend `docs.invite.*` when migrating.)
- [ ] `editor/Outline.tsx` / `editor/PresenceBar.tsx` — any visible labels/tooltips.
- [ ] `versions/format.ts` — relative/absolute time + autosave labels (locale-aware
      formatting, not just string swaps).

Do NOT translate collaborative document *body* content — only UI chrome.
