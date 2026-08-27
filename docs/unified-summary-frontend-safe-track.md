# Unified summary frontend safe track

## Behavior List

- Entry: this branch adds an isolated Storybook workbench and does not change the current production menu or route.
- Primary path: one assistant surface contains conversation, selected chat/member/template/time context, one composer, and one send action.
- Result states: personal Workflow completion, team Workflow confirmation/running, Agent preview/revision, clarification, explanation, stale preview, loading, and error are represented explicitly.
- Save boundary: only a current `agent_preview` or `agent_revision` carrying `save_preview` remains saveable; explanation and clarification never become drafts.
- Scope safety: changing chat/member/template/time increments `scopeVersion`, keeps old content visible, and disables stale preview saving or stale proposal confirmation.

## File Map

- `packages/dmworksummary/src/bridge/summaryWorkbench/model.ts`: protocol-facing state, reducer-like transitions, and presentation selectors; no network calls.
- `packages/dmworksummary/src/bridge/summaryWorkbench/model.test.ts`: save, proposal, explanation, and stale-scope invariants.
- `packages/dmworksummary/src/ui/SummaryWorkbench/types.ts`: pure UI props and view-model types.
- `packages/dmworksummary/src/ui/SummaryWorkbench/index.tsx`: single-entry presentational workbench.
- `packages/dmworksummary/src/ui/SummaryWorkbench/index.css`: token-only full and panel layouts.
- `packages/dmworksummary/src/ui/SummaryWorkbench/SummaryWorkbench.stories.tsx`: interactive Mock plus representative states.
- `packages/dmworksummary/src/ui/SummaryWorkbench/SummaryWorkbench.test.tsx`: visible actions and interaction callbacks.
- `packages/dmworksummary/src/i18n/{zh-CN,en-US}.json`: workbench labels and placeholders.

## PR Scope

This safe-track branch does:

- establish the frontend state contract around backend-owned `result_type` and `available_actions`;
- implement a single-composer workbench that can be reviewed in Storybook;
- demonstrate the three product paths without issuing HTTP requests;
- reuse current theme tokens and prepare callbacks for existing selectors.

This safe-track branch does not:

- replace `SummaryCreatePage`, `SummaryListPage`, or the current menu entry;
- call Chat, SSE, History, Workflow, confirmation, or save APIs;
- change `AgentChatPanel`, `summaryApi.ts`, or the legacy `normal | agent` contract;
- decide the execution route from selected fields on the client.

Impact is limited to new module-owned UI/bridge files, Storybook fixtures, tests, and localized copy.

## Verification Plan

- Automated state tests: `pnpm --filter @dmwork/summary exec vitest run src/bridge/summaryWorkbench/model.test.ts`.
- Component tests: `pnpm --filter @dmwork/summary exec vitest run src/ui/SummaryWorkbench/SummaryWorkbench.test.tsx`.
- Type check: `pnpm --filter @dmwork/summary typecheck`.
- i18n and style checks: `pnpm i18n:check`, `pnpm lint:css:ci`, and `git diff --check`.
- Story review: open `Summary/UnifiedSummaryWorkbench`; verify initial, Workflow, team confirmation, Agent revision, stale, long-content, full, and panel states in light and dark themes.

## Verification Result (2026-08-26)

- `@dmwork/summary`: 51 test files and 665 tests passed.
- Workbench state and component tests: 14 tests passed.
- i18n, CSS lint, Prettier, and `git diff --check` passed.
- Package-wide TypeScript remains blocked by the repository's existing React 17/18/19 and Semi declaration conflicts; filtered output contains no new workbench semantic error beyond the same missing React and Storybook declarations.
- Storybook static build transformed 10,265 modules before the process exited with code 139; browser-mode verification could not bind its local port inside the sandbox. Visual review therefore remains a pre-submit check.

## FE1 Contract Adapter Extension

### Behavior List

- Entry: no new user-visible entry; production pages continue using the legacy flow.
- Primary path: a future feature container can send one `summary_workspace` request and receive a typed clarification, proposal, Workflow, or Agent preview result.
- Recovery: History is normalized into the existing workbench model without letting unknown result types or actions become executable UI state.
- Side effects: team confirmation and preview saving use deterministic endpoints with idempotency keys; preview saving decodes the existing task result instead of pretending it is another Agent turn.
- Compatibility: existing `summary` Agent chat and save callers keep their current request and response contracts.

### File Map

- `packages/dmworksummary/src/bridge/summaryWorkbench/protocol.ts`: wire DTOs, shared constants, scope serialization, and structured API errors.
- `packages/dmworksummary/src/bridge/summaryWorkbench/adapter.ts`: fail-closed runtime validation plus turn and History normalization.
- `packages/dmworksummary/src/bridge/summaryWorkbench/adapter.test.ts`: malformed contract, action filtering, and History hydration coverage.
- `packages/dmworksummary/src/Service/SummaryWorkbenchService.ts`: semantic Chat, stream, History, confirm, and save facade.
- `packages/dmworksummary/src/Service/SummaryWorkbenchService.test.ts`: Service request construction, idempotency, and response normalization.
- `packages/dmworksummary/src/api/summaryApi.ts`: authenticated raw transport functions that reuse the existing Summary API and SSE infrastructure.
- `packages/dmworksummary/src/api/__tests__/*`: endpoint, body, header, and structured SSE regression tests.

### PR Scope

This FE1 extension does:

- freeze the frontend-facing `summary_workspace` protocol;
- add transport and Service boundaries behind the existing isolated workbench;
- reject malformed or unknown structured results before they reach UI state;
- preserve the legacy production entry and Agent behavior.

This FE1 extension does not:

- connect selectors or create the feature hook/container;
- replace `SummaryCreatePage`, `SummaryListPage`, `ChatSummaryPanel`, or `module.tsx`;
- expose the unified entry in production;
- assume that pending backend endpoints are available in a deployed environment.

### Verification Plan

- Contract and Service tests: run the new protocol and Service suites.
- Transport regression: run `summaryApi.test.ts` and `agentChatStream.test.ts`.
- State regression: run `summaryWorkbench/model.test.ts` after adapting structured results.
- Formatting and integrity: run Prettier on changed files and `git diff --check`.
- Package regression before commit: run the complete `@dmwork/summary` Vitest suite.

### Verification Result (2026-08-26)

- FE1 contract, Adapter, Service, transport, and state suites: 89 tests passed.
- Complete `@dmwork/summary` regression: 56 test files and 761 tests passed.
- `git diff --check` passed.
- Package-wide TypeScript still reports the repository's existing React/Semi declaration conflicts; filtered output contains no FE1 file errors.
