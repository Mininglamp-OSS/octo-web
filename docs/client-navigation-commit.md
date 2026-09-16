# Client Navigation Commit

## Behavior List

- Existing Client messages, contacts, app conversations, and summary entry points
  remain unchanged. No new browser route or user-visible control is introduced.
- The Client may send a positive safe-integer `navigationId` with a navigate
  command. The embedded UI acknowledges that exact ID only after the requested
  page and, when supplied, conversation target have committed.
- Superseded navigation, suspension, space changes, and unmount cancel old work.
- Loading content belonging to the requested target is sufficient; network
  completion is not required.
- Same-route summary resumes preserve unsaved drafts and list state. A different
  detail/confirmation task resets only that task page before acknowledgement.
- Same-conversation communication resumes preserve the mounted composer, draft,
  attachments, and scroll state, including a conversation opened from the sidebar
  or by a legacy command before the host requests an acknowledgement.
- Old Client bridges remain supported. Ordinary browser Web has no new host
  protocol; it shares the task-identity reset described below.
- Workspace-group transitions keep their attachment-confirmation and
  same-conversation preservation flow. The paired Client omits navigation IDs
  for transitions into or out of that presentation, so it cannot hide the
  guest's confirmation dialog while waiting for a user decision.

## File Map

- `apps/web/src/client-feature/`: shared commit reporting helper and tests.
- `apps/web/src/client-communication/`: optional bridge contract, capability
  advertisement, page/conversation commit integration, and regression tests.
- `apps/web/src/client-communication/runtime/`: strict ID forwarding through the
  owner and lazy UI, with queued navigation cancelled on suspension.
- `apps/web/src/client-summary/`: optional bridge contract, route commit
  integration, capability advertisement, and regression tests.
- `packages/dmworksummary/src/workspace/SummaryWorkspace.tsx`: key detail and
  confirmation pages by task ID. This shared change also applies to browser Web.
- `packages/dmworkbase/src/EndpointCommon.tsx` and `Pages/Chat/index.tsx`: optional
  real-commit callback for new conversations and in-place presentation updates.
- Ordinary browser entry points and server APIs are outside this change.

## PR Scope

- Add optional `navigationCommitVersion: 1` to renderer readiness only when the
  preload exposes `reportNavigationCommitted`.
- Add `navigationId?: number` to navigate commands.
- Add optional `reportNavigationCommitted({ navigationId }): Promise<void>`.
- Keep route reporting separate from commit acknowledgement.
- Do not change dependency versions, browser routing, data ownership, or UI
  controls. Shared changes are the task-identity reset and the optional
  conversation commit callback; ordinary Web callers need not provide it.

## Commit Boundaries

- Communication page/presentation changes acknowledge from a layout effect.
  Normal conversation targets additionally wait for `EndpointCommon`'s optional
  `onCommitted`: a live page ref after mounting or the `setState` completion
  callback after updating workspace embedding in place. No conditional wrapper
  is inserted around the normal chat page. App-bot host routes consistently use
  `NavigationCommitBoundary`, with or without a navigation ID.
- A cached target is reusable only after a genuine commit. Every right-route
  operation and non-noop host target dispatch invalidates that cache. Generation,
  space, and route revision checks reject obsolete completions. `openChannel`
  alone is never commit evidence. Preservation additionally requires a root-only
  route and a matching live conversation instance in `EndpointCommon`.
- Workspace embedding updates compare against queued state in a functional
  updater. A newer presentation cannot incorrectly skip its update because an
  older one is still waiting to commit.
- Summary acknowledgement tokens do not remount the workspace. Its identity
  changes only with the space revision, retaining same-route drafts and list
  state during host hide/resume. Detail and confirmation pages use task ID keys
  so changing tasks cannot acknowledge a subtree retaining the previous task.
  Creation and share pages retain their existing semantic keys.
- The shared workspace key change is intentional: browser Web also gets a fresh
  detail/confirmation instance on an actual task change. Business page internals
  and the ordinary Web entry remain unchanged. Navigation identity/reporting is
  extracted into `client-feature`; existing large shell files retain only local
  route wiring.
- Both shells scope the controller to the bridge instance and dispose it on
  replacement/unmount. Callbacks carry their controller as well as its numeric
  token, preventing a stale callback from releasing a replacement controller.
- Once both DOM barriers release, acknowledgement delivery uses the existing
  ready reporter: at most three attempts, each with a 750 ms timeout and 100 ms
  between attempts. The nominal retry budget is 2.45 seconds from DOM commit,
  not from the host's request. Cancellation and supersession stop further
  attempts. A resolved bridge call is not proof of host receipt, and exhausted
  retries never authorize revealing stale content. The paired Client's
  five-second reveal timeout still fails closed and offers retry.

## Verification

Review-fix verification on 2026-09-16, after rebasing onto `ce670e8f`:

- 363 tests in 37 files passed for the three embedded entry/support directories.
  The new real `EndpointCommon` + `WKViewQueue` suite covers sidebar/legacy
  preservation, repeated IDs, queued presentation updates, held A-B-A routes,
  internal detail routes, bridge replacement, and cancellation.
- 37 shared EndpointCommon/workspace-embedding tests and all six existing shared
  summary workspace tests passed.
- The ordinary Web production build and both mock embedded artifact builds
  passed. No dependency or release-pin changes were made.
- All 12 targeted paired-Client Electron cases passed across the full run and
  focused reruns. These include real sidebar-to-host same-conversation navigation
  with draft/attachment preservation in both runtime modes, summary state, and
  five workspace cases. Some attempts timed out while waiting for Electron's
  first window, before business assertions; the startup deadline was not changed.
- A TypeScript semantic comparison of the five changed production files against
  the rebased HEAD found no introduced diagnostics (155 baseline, 154 current).
  Existing shared React typing diagnostics remain; this is not a clean Web
  typecheck claim.

Historical verification on 2026-09-15:

- After rebasing onto `43692a07`, 337 tests in 35 files passed for the three
  embedded entry/support directories, including the runtime paths.
  This includes a held route queue: committing an obsolete subtree must not
  acknowledge the current target, and only the latest subtree releases its ID.
- Four new shell tests use the real workspace to cover internal creation drafts,
  list state, same-task detail/confirmation edits, new-task resets before
  acknowledgement, legacy resumes, and space isolation. All six existing shared
  workspace tests also passed.
- The ordinary Web production build passed.
- The pinned runtime integration passed 72 tests in eight runtime/contract/helper
  and summary-state files; communication and summary mock artifact builds passed.
- Fifteen Client Electron cases passed across standard protocol and isolated
  source-branch integration builds, including real Web with
  background runtime both enabled and disabled, app-bot navigation, summary
  routing, summary creation draft preservation with runtime on/off, legacy
  capability fallback, stale replies, and concealment pixel checks. Five workspace
  composer/attachment-confirmation cases ran with background runtime off,
  including an interrupted confirmation retried after hide/resume.
- A concurrent broad run exceeded the existing 15-second real-summary cold-import
  deadline. Re-running the complete 35-file set with one worker passed all 337
  tests. The test deadline was not increased.
- Existing build warnings about large chunks/eval and jsdom canvas/document
  navigation limitations remain. No full product or packaged-release E2E claim
  is made.

From the OSS Web worktree:

```bash
pnpm --dir apps/web exec vitest run src/client-communication \
  src/client-summary src/client-feature --maxWorkers=1
pnpm --dir packages/dmworksummary exec vitest run \
  src/workspace/SummaryWorkspace.test.tsx --maxWorkers=2
pnpm --dir packages/dmworkbase exec vitest run \
  src/__tests__/EndpointCommon.presentation.test.tsx \
  src/Pages/Chat/__tests__/workspaceEmbedding.test.tsx --maxWorkers=1
pnpm --dir apps/web run build
```

Build local mock artifacts from this compatible Web worktree:

```bash
pnpm --dir apps/web exec vitest run src/client-communication/runtime \
  src/client-feature/runtimeContract.test.ts \
  src/client-feature/navigationCommit.test.ts \
  src/client-summary/SummaryShell.navigation-state.test.tsx --maxWorkers=2
env OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 OCTO_ALLOW_MOCK_CLIENT_ARTIFACT=1 \
  VITE_E2E_MOCK=1 VITE_E2E_MOCK_IM=1 \
  VITE_API_URL=http://mock.e2e.local pnpm --dir apps/web run build:client-communication
env OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 OCTO_ALLOW_MOCK_CLIENT_ARTIFACT=1 \
  VITE_E2E_MOCK=1 VITE_E2E_MOCK_IM=1 \
  VITE_API_URL=http://mock.e2e.local pnpm --dir apps/web run build:client-summary
```

## Integration Baseline

Initial verification used a separately patched `f05fb47d` runtime baseline while
OSS main was `4a1eb043`. Initial submission was rebased onto `43692a07`;
the review-fix worktree is rebased onto `ce670e8f`. Both contain the runtime and
workspace integration. The runtime parser, owner forwarding, lazy UI
cancellation, and mount-time capability advertisement now belong to this PR.
Existing scope changes, external summary attention, workspace attachment guards,
and the forwarding surface are preserved.

The paired Client is rebased onto `1350219`. Its upstream communication pin
`c023fd4c` and summary pin `f05fb47d` remain unchanged. Current integration uses
mock artifacts built from this Web branch, not the historical pinned worktree.
Mock builds declare `e2eMock: true` and dirty builds declare `sourceDirty: true`;
neither is a release artifact. Publishing/installation and updating Client pins
require committed compatible production artifacts in a separate release step.
The Client's `tests/fixtures/navigation-e2e.config.ts` uses the exact mock
manifests as test-only expected pins in a separate guarded build. Artifact
metadata and tracked release manifests are not rewritten.
