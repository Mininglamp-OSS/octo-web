# Unified summary versioning: frontend pre-work

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
