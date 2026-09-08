# Artifact Review Fixes

## Behavior List

- Summary cards in Communication open the corresponding Summary task or share.
- Share preview, detail, and return-to-chat remain available without Web's menu router.
- Changing Space discards the previous workspace's detail, draft, selection, and late callbacks.
- Summary creators can add human members through the standalone workspace.
- Only the trusted Summary main frame can request microphone access; Apps stays denied.
- Logout/account changes cancel pending renderer creation and stale permission callbacks.
- Preserve upstream's capability-gated Summary Workbench in Web and Client.
- Keep Apps conversations in Apps, using Web's existing app-specific conversation view.
- Summary JSON and SSE 401 responses delegate session teardown to the host.

## File Map

- `apps/web/src/client-communication/summaryNavigation.ts`: adapt existing card navigation to the host.
- `apps/web/src/client-summary/SummaryShell.tsx`: Space-scoped workspace and host callbacks.
- `packages/dmworksummary/src/workspace/`: controlled task/share navigation.
- `packages/dmworksummary/src/features/summaryMembers/`: standalone member selection.
- `packages/dmworksummary/src/utils/summaryAttentionBadge.ts`: reset attention scope.
- `packages/dmworksummary/src/features/summaryWorkbench/`: preserve the unified entry,
  delegate group-member reads and completed-task navigation to the host.
- `packages/dmworksummary/src/api/summaryApi.ts`: share the host authentication boundary.
- `packages/dmworkappbot/src/features/AppBotConversationView.tsx`: reuse the Web app conversation UI.
- Client `electron/main/communication/ipc.ts`: validate Summary navigation.
- Client `electron/main/embedded-feature/`: scoped reporting, lifecycle, microphone permissions.
- Client preload and renderer: route the validated navigation to the Summary view.

## Repair Scope (2026-09-07)

Fix the five integration issues identified in review. Preserve default Web adapters,
existing APIs, user-visible entries, and the frozen Client worktree. Do not migrate
Client main, redesign pages, publish, or commit as part of this repair.

## Verification Plan

- Summary navigation adapter tests, including share preview and legacy task numbers.
- Space-change tests with drafts/details and delayed callbacks.
- Member selection tests with bot/existing-member filtering and stale responses.
- Client IPC validation and manager lifecycle/permission tests.
- Existing Summary/AppBot/Web tests and Client typecheck/build.
- Artifact builds and focused integration E2E when local dependencies permit.
- Record any unrun real-device, microphone, or production API checks explicitly.

## Verification Results (2026-09-07)

Completed against the repair worktrees:

| Check | Result |
| --- | --- |
| Web unit suite | 1,463 passed, 128 files |
| Summary unit suite | 1,206 passed, 79 files |
| Apps unit suite | 24 passed, 9 files |
| i18n check | Passed |
| Default Web production build | Passed |
| Communication / Summary / Apps E2E artifact builds | Passed, isolated test outputs |
| Default Web Summary E2E | 30 passed |
| Client typecheck and renderer/main/preload build | Passed |
| Client unit suite | 121 passed |
| Client artifact integration E2E | 9 passed |
| Both worktrees `git diff --check` | Passed |

The 30 default Web E2E cases cover capability-enabled and legacy creation,
list/detail/search, Agent refinement, versions, editing, collaborative submission,
in-chat history/detail/creation, schedules, and standalone detail/share links.
They use the default Web entry, not the artifact entry.

Client E2E covers lazy loading, rollback switches, shared bootstrap, navigation
through the single IM runtime, badges, crash recovery, account changes and
session expiry. The added regression clicks an actual type-15 message card,
opens Summary detail by `task_no`, selects and submits a new member using the
unchanged HTTP endpoint, switches Space, rejects an old-Space conversation
request, and verifies that a draft is discarded across another Space switch.
An additional case returns HTTP 401 from the actual Summary detail request and
checks that Summary, Apps, and Communication renderers are all destroyed.

Electron View reattachment can leave Playwright's navigation wait pending.
The Summary interaction test uses native `webContents.sendInputEvent` clicks
and DOM readback, matching the repository's existing Communication E2E pattern.
It does not replace the production click handler or directly invoke the member
save method.

The lifecycle tests compile the current production manager in memory on every
run. Only the Electron environment and artifact lookup are mocked; there is no
checked-in generated manager bundle or independently reimplemented state
machine. Tests cover pending storage cleanup/load across logout, hide/reuse,
load failure, queued Space-before-navigation ordering, bootstrap/report scope
and Apps deny-all permissions.

Current local E2E artifacts are at
`/var/folders/m3/52j9pv3x2wq9nj9frn0wx6j00000gn/T/octobuddy-upstream-repair-oeFsHR`.
Reproduce the Client integration suite from its frozen worktree:

```bash
pnpm run build
E2E_RENDERER_PORT=5188 \
OCTOBUDDY_OCTO_ORIGIN=https://octobuddy.e2e.invalid \
OCTOBUDDY_COMMUNICATION_RENDERER_DIR=/var/folders/m3/52j9pv3x2wq9nj9frn0wx6j00000gn/T/octobuddy-upstream-repair-oeFsHR/communication/renderer \
OCTOBUDDY_SUMMARY_RENDERER_DIR=/var/folders/m3/52j9pv3x2wq9nj9frn0wx6j00000gn/T/octobuddy-upstream-repair-oeFsHR/summary/renderer \
OCTOBUDDY_APPS_RENDERER_DIR=/var/folders/m3/52j9pv3x2wq9nj9frn0wx6j00000gn/T/octobuddy-upstream-repair-oeFsHR/apps/renderer \
pnpm exec playwright test tests/e2e/embedded-features.spec.ts
```

The E2E auth session and launcher now default to the reserved `.invalid` host.
The add-member failure came from a fixture matching `/personal/versions` instead
of `/personal-versions`: an unhandled request previously reached the live API,
received 401 and cleared the active Space. The fixture is corrected and asserts
the posted `X-Space-Id`; the production Space guard is retained unchanged.
Those earlier failures are not live-backend acceptance evidence.

## Upstream Reconciliation

- Rebased all 11 branch commits onto `upstream/main` at `9e33837a`.
- Rebased HEAD is `251c63e3`; no unresolved conflicts remain.
- Preserved the unified workbench, capability fallback, quality-gate warnings,
  Space capability invalidation and removal of scheduling from manual creation.
- `SummaryWorkspace` now uses the unified entry. Explicit host callbacks work
  for full-width as well as embedded-panel layouts; group members use the host
  messaging port when supplied.
- Restored all pre-rebase tracked/untracked changes. A local backup branch and
  stash remain available; no remote branch was changed.
- Client expectations were updated to the rebased HEAD. Rebuild Client after
  changing these JSON files: their values are compiled into the main process.
- Non-mock local preview artifacts were rebuilt against the same source. They
  still have `sourceDirty: true` and are not releasable production artifacts.

## Release Boundary

- Communication requires contract revision 3; Summary requires 2; Apps stays at 1.
- At the 2026-09-07 verification snapshot, rebase had rewritten local branch
  commits and the remaining repairs were uncommitted; no push, merge, packaged
  production resource overwrite or release had occurred.
- The 2026-09-08 submission includes Web source, tests and documentation only.
  Client changes and generated artifacts remain outside this Web submission.
- Existing Client production resources remain on the old protocol. Do not start a
  production validation run with those old resources and the new host.
- After committing Web source, build from the clean commit without E2E flags;
  update Client pinned commit IDs and artifacts together in a separate change.
- E2E manifests are explicitly dirty/mock, generated from HEAD `251c63e3` plus
  the local changes. They are not production deliverables.
- Actual microphone capture, OS permission UI and live production backend behavior
  require separate manual acceptance. Automated permission tests do not prove
  real microphone recording or transcription.
