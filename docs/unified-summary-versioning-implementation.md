# Unified summary versioning: frontend pre-work

## Native real-model repair delivery (September 9, 2026)

The native Web now runs `octo-web:native-real-model-20260909` on 28360.
Its existing API/Worker business image is unchanged; model environment keys
match the corresponding 28140 containers. Local auth/source services, native
database, rollout flags and disabled notifications remain unchanged.
Deployment verified unchanged content fingerprints and protected container
identities/start times; old containers are retained for recovery. No reseed,
existing summary overwrite, 28140/28350 update, push or PR.

Only `SummaryWorkbenchFeature.tsx` gallery rollback behavior changed: failed
submissions restore editable input without reopening templates over the
conversation. Existing manual template trigger, initial gallery, new-session
reset and direct-team retry state remain. No CSS, template, UI component,
Service, route, copy or shell redesign. The Octo skill constrained the repair
to the existing interface, and browser review confirmed the reply area.

Verification: 52 focused tests and all 89 Summary files / 1283 tests pass; normal
Web build, i18n and both diff checks pass. Logs:
`.codex/real-model-gallery-{focused,vitest,build,i18n,image}.log`.
Deployment script allowlist/isolation tests (2) pass. Existing broad typecheck
failures are not resolved or claimed clean.

Real browser acceptance used the original new-summary entry, one selected
operations chat and a one-month range: Agent `fetch_channel` retrieved 94
messages, then `summarize_chunk` and `merge_summaries` produced a Chinese
preview with citations. Saved as task 60,
`镜像验收-真实模型-运维总结-20260909`. Native "continue optimize" ran through
the real Worker, completing V2/revision 2 while retaining V1. Both versions
have non-Alpha content. Total tasks 59→60; old Alpha versions 52/V2, 56/V2 and
59/V1 remain untouched; notifications and active schedules for this test are 0.
Reload confirmed V2 persistence. Restored conversation keeps templates hidden;
manual Template opens them; New session restores the initial gallery.
Screenshot reviewed at 1280×720; original layout retained and gallery absent
after submission. Full breakpoint/theme/accessibility matrix not rerun.

Separate pre-existing routing issue found during acceptance:
`classifySummaryWorkspaceIntent` treats any occurrence of "依据"/"来源" as an
explanation before checking generation intent, even without a current preview.
The first request fetched messages but returned only an explanation.
An explicit preview request then generated/saved successfully. This repair
does not change routing; record this limitation rather than claim all natural
language requests or the overall unified-summary plan are complete.

## Native real-model repair (September 9, 2026, before implementation)

1. Behavior: the initial template gallery and explicit template trigger remain.
   Submission closes the gallery during loading and after success or failure;
   failures retain editable requirements/error feedback without reopening it.
   New session restores the gallery. Preserve direct-team retry semantics.
2. File map: `SummaryWorkbenchFeature.tsx` owns gallery state; its existing test
   covers pending/failed/retry/manual reopen/new-session behavior. No CSS,
   presentational component, Service, routing, template or copy changes.
3. Scope: only the native 28360 preview uses 28140's existing real model
   settings, with user approval. Preserve native data, login/source services,
   disabled notifications and existing version rollout. Never alter 28140/28350,
   overwrite old Alpha versions, reseed, push or open a PR for this repair.
4. Verification: focused and complete Summary tests, i18n and normal Web build;
   native-only deploy with idle checks and recoverable container backups;
   browser creation with real Agent tools, visible reply, and retained layout.
   No new prototype/component or asset replacement is involved.

## Native list/action delivery (September 9, 2026)

The existing Octo card/list/workspace/chat entry now uses per-task capabilities
and an explicit one-shot detail intent. Same-owner completed personal summaries
have the same actions regardless of historical Agent/Workflow source.
Refine opens the original detail and appends to its content; referenceability
never authorizes mutation. Delayed binding, task/Space mismatch, unavailable
formal content and legacy target-specific permissions are guarded.

The Octo skill kept this work inside the existing shell, controls and detail
layout. Browser review found an oversized configuration modal; its form now
scrolls internally through a scoped wrapper, without global theme overrides.

Verification after the layout fix: 89 Summary test files / 1,282 tests, normal
Web build and i18n pass. Backend full race tests with actual MySQL, bounded
list-query/Catalog parity and paired original-target V2 tests pass. Typecheck
does **not** pass: 6,062 diagnostics vs prior configuration slice 6,035 and
upstream 6,025; React/Storybook declarations and resulting type failures remain.
Logs are `.codex/native-actions-layout-{vitest,build,i18n,image}.log`,
`.codex/native-actions-final-typecheck.log` and backend
`.codex/native-actions-{mysql,backend-race,final-vet}.log`.

Full-host preview: Web `octo-web:native-actions-layout-20260909` on 28360,
API/Worker `octo-summary-execution:native-actions-20260909` on 28361/internal.
It retains the existing native database, real local Octo login/source services,
and synthetic local model with notifications off; not a component-only host.
Backend `tests/content-system-mirror/update.mjs` retains previous containers,
checks exact targets, refuses reseeding/repeated updates and supports a scoped
`--web-only` layout update. Original 28140 and diagnostic 28350 are untouched.

Browser acceptance: no Agent/Quick list classification; tasks 56 (historical
Agent) and 52 (historical Workflow) show the same edit/refine/configuration menu,
each gained V2 in the original task and retained V1 after reload. Task count
remains 58. Task 58 rejected the synthetic provider's fixed `[1]` citation,
which is absent from its retained evidence; V1 stayed current and the UI showed
failure retention. No safeguard was relaxed to make the test pass.
Configuration opened on the original task; schedule fields expanded without
saving a plan or submitting a run. The revised modal measured 480×736 within
an 839×926 viewport, with internal scrolling and no horizontal page overflow.
This is not a full multi-viewport/theme/two-account acceptance.

The browser initially reused cached HTML for `/summary`; loading
`/summary?build=native-actions-layout-20260909` fetched the new hashed bundle.
If old labels remain, refresh with this query instead of evaluating old code.

Remaining scope: full new-creation/V1 integration, non-pilot detail adapters,
team/group/member writers and scheduled rounds, generation events, lifecycle,
types and full-system acceptance. No push or PR; this is a completed slice,
not completion of the entire first inventory batch or overall plan.

## Native list/action slice (2026-09-09, before implementation)

1. Behavior: engine-neutral summary metadata and menus; existing list/workspace/
   chat actions open the original detail with an explicit, one-shot content
   action. Refine never enters reference-based creation. Missing or failed
   formal capabilities never grant a legacy write fallback.
2. File map: backend shared capability calculation and batched list projection;
   frontend SummaryContentContract plus bridge/summaryWorkbench/listActions and
   detailAction intent; existing card/list/workspace/chat/detail adapters and
   module locales. Extend existing tests; do not create a parallel UI surface.
3. Scope: first completed single-person convergence slice and read-only business
   metadata for other scopes. Retain execution rollout, ownership, existing
   legacy adapters and unrelated changes. No deployment or PR before checks.
4. Verification: paired Agent/Workflow capabilities and original-target actions,
   query-count bound, no wire evidence/run input leakage, unavailable/managed
   fallback guards, delayed detail readiness, task/Space changes, full Summary
   tests, backend focused/full checks, i18n and normal Web build.

## Product convergence inventory (2026-09-09)

The authoritative remaining-work inventory is
[原生 Octo 分流清单与后续开发顺序](/home/mlamp/worktrees/summary-versioning-frontend/docs/unified-summary-engine-branch-inventory.md).
It records the verified official main heads, remaining engine-based UI/action
branches, backend prerequisites and paired historical-summary acceptance tests.
The native single-person detail pilot below is not acceptance of the unified
product requirement. This inventory update changes no business code or mirror.

## Native Octo integration correction (2026-09-08)

1. Behavior: keep the existing Summary list/detail route, title, metadata,
   citation renderer, copy/forward actions, inline editor and version sidebar.
   Route existing refine/edit/history/schedule actions through formal capabilities
   for enrolled tasks. Loading/errors must not re-enable legacy mutations.
   The standalone fixture is diagnostic only, not the delivered product.
2. File map: a headless feature binding connects `useFormalContent` to the
   existing class page; native history/configuration presentation lives under
   `ui/SummaryWorkbench`; the existing editor accepts a scoped save callback.
   Tests cover native DOM retention, formal-only writes and error gating.
3. Scope: correct the Summary module integration only. No host navigation,
   login, shared theme or unrelated mirror changes; no production deployment.
4. Verification: focused and full Summary tests, i18n and production Web build;
   deploy the normal Web entry in a separately named full-host preview and
   verify login/navigation/detail. Keep 28140 and fixture data intact.

## Current result (September 8, 2026)

The single-person pilot is now wired through the existing detail entry and
Workbench module. Production `Service → bridge → feature → UI` components
support configuration/schedules, explicit save-and-generate, refinement,
in-place edit/restore, cancellation, candidate application and formal history.
The pure panel exposes grouped state/actions and uses scoped design tokens;
no shared theme or new product route was added. The existing chat selector
stays mounted so its visibility transition actually loads source candidates.

Accepted runs are retained before refresh, so a failed GET cannot lose polling
or revive stale edit controls. Transport retries reuse a key; a new explicit
retry after an acknowledged terminal run gets a new key. A managed entry never
falls back to legacy writes on read failure.

Final tests: 86 files / 1,255 tests, production Web build and i18n passed.
Typecheck remains blocked (6,035 diagnostics vs upstream 6,025, due to existing
React/Storybook type resolution on newly added files and inherited selector JSX).
The test-only Web image at `127.0.0.1:28350` exercised real API/Worker execution,
source selection, save-only vs save-and-run, queued action gating, V5 generation,
V7 refresh and seven-version history. See `tests/content-execution-mirror/README.md`.
The older continuation notes below describe prior milestones, not current state.

Still not complete: team/group/initial-create coordination, event notifications,
non-pilot entry convergence and real-history/two-account 28140 acceptance.
No branch push or PR was performed.

## Configuration/execution slice (2026-09-08, before implementation)

1. Behavior: the existing detail entry uses a capability-gated formal-content
   panel for the single-person pilot; configuration, schedule, frozen-content
   refinement and regeneration share that entry. Team and non-pilot entries
   remain unchanged. A managed task never falls back to legacy writes on error.
2. File map: extend SummaryContentContract/Service and decoder; add a
   `bridge/summaryWorkbench/useFormalContent` controller, a pure
   `ui/SummaryWorkbench/FormalContentPanel` with Story, and a thin
   `features/summaryWorkbench/FormalContentFeature`; detail supplies task/Space.
3. Scope: only the existing summary module. No new routes, global theme
   changes, invitation changes, or copy/save-as-new capability.
4. Verification: Service and controller tests, configuration defaults vs
   save-and-run, reload/Space races and action gating, zh/en i18n, production
   build, Story browser checks and isolated image workflow.

## Behavior list

1. Reuse the existing summary list/detail and Workbench; no duplicate routes or engine-based menus.
2. Target either the main result or the caller's report explicitly. Server capabilities govern actions; preview versions never substitute for formal content/version identities.
3. Show content revisions and pageable historical versions. Confirm edit/restore overwrite semantics; disable edit/restore/save-as-new during active generation.
4. Refine frozen content by default. Offer direct/configured regeneration only when supported; refresh restores persisted run state without submitting again.
5. Preserve citation privacy and history behavior, and display translated loading/empty/failure/conflict/configuration states across Space changes.

## File map

1. `packages/dmworksummary/src/Service/SummaryWorkbenchService.ts` and Service types/tests: API endpoints, envelope compatibility, idempotency keys and revision baselines.
2. `bridge/summaryWorkbench/`: adapt server content targets, capabilities, formal versions and generation state; handle stale responses/Space changes.
3. `features/summaryWorkbench/`, `ui/SummaryWorkbench/`: existing business container and presentation; add stories before wiring any new UI.
4. `pages/SummaryDetailPage.tsx`, `components/SummaryCard.tsx`: thin entry/capability wiring, no added raw API calls.
5. Module i18n and tests/stories: zh-CN/en-US, light/dark, authorization/dual-citation regressions.

## PR scope

Only the summary module's unified formal-content workflow and compatibility contract, paired with the backend branch of the same name. No new route, shared theme redesign, unrelated legacy cleanup, or octo-server changes. Production actions remain gated until all backend writers understand the protocol.

## Verification plan

1. Focused Vitest for Service, bridge, features, detail and citations, plus typecheck/production build.
2. `pnpm i18n:check` and `git diff --check`.
3. Story verification in light/dark and zh-CN/en-US for new presentation states.
4. API/worker/web mirror test at the existing local environment after preserving its configuration and prior images.
5. Personal and team workflows, six-version pagination, edit/restore invariants, conflict/cancel/reload/Space switch and private citation isolation; record actual results before opening a PR.

## Formal command continuation (2026-09-08)

The existing `SummaryContentService` and Workbench formal-content bridge now
support edit/restore, durable refinement requests, run reads/cancellation and
candidate application. Requests carry explicit Space, formal version/revision
baselines and a caller-owned stable idempotency key. Responses validate target
identity, run state, next current revision and citation privacy; preview IDs
cannot become formal write baselines.

This is Service/bridge preparation, **not UI action wiring**. Backend production
command routes remain unmounted while legacy writers, cleaners and scheduling
are integrated. No route, menu, button, Story or visual design was introduced
in this slice. The existing Workbench remains the sole intended entry.

Verification: 82 Summary test files / 1,236 tests passed, production Web build
and i18n check passed. Typecheck retains the same 6,025 pristine-upstream
diagnostics, with no added diagnostics after path/line/footer normalization.
