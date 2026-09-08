# Artifact Review Fixes

## PR 1640 Follow-up Plan (2026-09-08)

### Behavior List

- Summary member selection excludes bots and inactive/deleted group members
  without relying on the Summary renderer's IM cache.
- Switching Space or resetting Apps invalidates pending app selections before
  they can update selection, report analytics, or open a conversation.
- Mock artifact builds require an explicit opt-in; Apps retains the same host
  authentication-expiry behavior under tests and production.
- An expired forwarding context reports a retryable error; a user-initiated
  cancellation remains silent.
- Unknown host commands do not change renderer visibility. Summary and Apps
  entry startup must not start an IM connection, including through modules.

### File Map

- `packages/dmworksummary/src/host/`: complete member DTO, subscriber adapter,
  active-member policy and forwarding-context handling.
- Summary member/workbench features: consume the member policy and test the
  actual SDK-to-host conversion without a populated Summary IM cache.
- `packages/dmworkappbot/src/features/appBotConversation.tsx`: invalidate stale
  selections, including Space A-to-B-to-A and overlapping requests.
- `apps/web/scripts/client-feature-build*.mjs`: explicit mock-build gate.
- `apps/web/src/client-{apps,summary}/`: authentication, visibility and boot tests.
- Package public sub-entries and Communication imports: expose focused APIs
  without routing consumers through full feature modules.
- `SummaryDetailPage.tsx`: remove formatting-only churn while retaining all
  semantic changes; verify normalized syntax before and after cleanup.

### PR Scope

Address the current review without changing backend endpoints, adding Web
entries, migrating Client main, or publishing generated artifacts. Preserve
Web adapters and frozen Client integration compatibility. No commit or push is
part of this repair step.

### Verification Plan

- Focused member, forwarding, Apps-race, artifact-build and entry-startup tests.
- Full Web, Summary and Apps unit suites plus i18n and diff checks.
- Default Web production build and isolated three-artifact builds.
- Default Web Summary E2E and frozen Client integration regression when the
  local test harness is available; keep mock outputs out of preview resources.
- Document static findings separately from server-side membership validation
  and live microphone/production-backend acceptance.

### Completed Repairs

- Map real SDK `Subscriber` records to host DTOs, preserving bot flags from
  `orgData`, deletion/status, avatar and the canonical display name. Both Web
  Workbench and standalone member selection reject inactive/deleted members.
  Tests use real SDK instances and do not require a populated local bot cache.
- Invalidate pending Apps selections on Space changes, reset and unmount.
  A-to-B-to-A cannot revive an old request; its `finally` cannot unlock a newer
  selection. Cover the helper and mounted React hook.
- Reject resolved API/IM mock build flags unless the process environment
  explicitly contains `OCTO_ALLOW_MOCK_CLIENT_ARTIFACT=1`. Neither dotenv nor
  the dirty-worktree opt-in can grant this authorization.
- Always install Apps' host auth-expiry handler after module/mock setup.
  HTTP 401 exercises the actual APIClient interceptor in both mock and normal
  entry boots; HTTP 403 remains a non-auth error.
- Report expired forwarding context through `onError` and show localized
  retry feedback in Web. User cancellation remains silent. Retain the existing
  Communication and Summary guards against stale cross-Space callbacks.
- Make Summary/Apps suspend and resume explicit; unknown commands do nothing.
- Export focused package sub-entries and migrate Communication consumers.
  Preserve legacy `/src/*` compatibility and Node10 TypeScript resolution.
- Remove formatting-only changes from `SummaryDetailPage.tsx`. The final page
  diff against upstream is +114/-78 lines, down from +1673/-526 in the PR head.
  The mechanical restoration checked normalized AST and emitted-JS equivalence;
  the resulting page also passed unit and default Web E2E regressions.

### Verification Results (2026-09-08)

| Check | Result |
| --- | --- |
| Web unit suite | 1,487 passed, 130 files |
| Summary unit suite | 1,221 passed, 81 files |
| Apps unit suite | 42 passed, 10 files |
| Real entry boot / API interceptor regressions | 5 passed, included in Web suite |
| i18n and `git diff --check` | Passed |
| Default Web non-mock production build and E2E build | Passed |
| Default Web Summary E2E | 30 passed |
| Communication / Summary / Apps artifact builds | All 3 non-mock and all 3 mock builds passed |
| Isolated frozen-Client build and artifact integration E2E | Build passed; 9 tests passed after fixture correction below |

Unit suite commands:

```bash
pnpm --dir apps/web exec vitest run --maxWorkers=4 --testTimeout=15000
pnpm --dir packages/dmworksummary exec vitest run --maxWorkers=4
pnpm --dir packages/dmworkappbot exec vitest run
pnpm i18n:check
git diff --check
```

The unmodified Web suite's macOS installer test exceeded its default 5-second
timeout in earlier runs. The final command allows 15 seconds and passes; no
updater source or test was changed. This is not a claim that the default timeout
is reliable on this machine. Standalone Summary typechecking still has existing
React/Semi typing failures and is not reported as passing.

The no-IM tests now dynamically import the actual feature entries after
installing a valid bootstrap and spies. They execute real BaseModule,
DataSourceModule and feature initialization, require the React render boundary
to be reached, and observe `startup`, `connectIM` and the SDK connection method.
UI rendering, external requests, analytics and MSW installation are test
boundaries; this is not a real WebSocket or production-backend acceptance run.
Timers, interceptors, mocks and Summary attention runtime are cleaned up.

### Isolated Client Verification

Verification artifacts and the temporary Client copy are under:

```text
/var/folders/m3/52j9pv3x2wq9nj9frn0wx6j00000gn/T/octo-pr1640-artifacts-XjGRvp
```

The copy uses the frozen Client source, with its three expected artifact commit
IDs changed only in that copy from `251c63e3` to `7cd1e2de`. Artifacts record
`sourceDirty: true` because these Web repairs are uncommitted. Non-mock build
success does not make these release artifacts. The original Client worktree,
its pins, preview resources and live backend were not changed.

The first integration run passed 8 tests and failed the add-member case: its
seed omitted `status`, which the existing mock provider converts to `0`.
The repaired member policy correctly excluded those records. Only the copied
test fixture was changed to explicitly give active members `status: 1`; it also
adds a robot and a `status: 0` member and asserts both are absent from the modal.
With those inputs, all 9 integration tests pass. Carry that fixture correction
into the separate Client artifact-update change; the original frozen test is
not claimed to pass unchanged against these new artifacts.

Intentional mock artifact builds now require this additional process flag,
in a disposable build worktree:

```bash
OCTO_ALLOW_MOCK_CLIENT_ARTIFACT=1 \
OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 \
VITE_E2E_MOCK=1 VITE_E2E_MOCK_IM=1 \
VITE_API_URL=https://octobuddy.e2e.invalid \
pnpm --dir apps/web run build:client-summary
```

Use the same explicit opt-in for `build:client-apps` and
`build:client-communication`. Clean release builds must use mock flags `0` and
must not rely on the dirty-worktree opt-in.

### Review Boundaries

- SDK `getSubscribes()` already filters deleted entries. The fix preserves
  deletion/status through the DTO and adds defensive filtering, rather than
  claiming that the SDK always returns deleted members.
- Client already rejects mock manifests outside E2E and validates trusted
  frames. The build gate is additional protection, not a new Client gate.
- Server-side add-member authorization, live production API behavior, real
  microphone capture and OS permission dialogs were not verified here.
- `upstream/main` was fetched and the PR branch rebase was a no-op at
  `9e33837a`. This repair remains local on top of `7cd1e2de`; nothing was
  committed, pushed, merged or released in this step.

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
