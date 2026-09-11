# Personal summary parity — implementation scope

## Behavior list
- Existing summary list/detail are the only entry points. Classify summaries as personal/team; scheduled updates remain metadata.
- Personal summaries from either engine support edit, continue-optimize, two-mode regeneration, scheduled updates and deletion, subject to existing ownership/Space permissions.
- Continue-optimize keeps the reference-to-Agent-chat/new-summary flow. Feedback regeneration modifies the current summary using existing streaming refinement; full regeneration uses the existing Workflow with progress, streamed body and sidebar generating state.
- Prefill the saved actual requirement. Complete only missing sources/time/requirement in the existing flow and save by default. Regeneration does not alter recurrence.
- Preserve prior versions/results on failure; use existing loading, error and history views, not a second status interface.

## File map
- `packages/dmworksummary/src/api`: existing summary HTTP boundary and optional regeneration configuration types.
- `packages/dmworksummary/src/utils`: personal/team classification and generation configuration adaptation with tests.
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx`: connect existing editor, modal, schedule and stream lifecycle.
- `packages/dmworksummary/src/components/SummaryCard.tsx` and list page: same permitted personal actions for both sources.
- Module-owned UI/bridge and locale resources: only if missing-configuration fields cannot reuse an existing form; add Story/tests before integration.

## PR scope
One capability-parity change, no wholesale legacy-branch import, new coordinator, team collaboration redesign, general Service migration, routing or login changes.
Impact stays in the existing summary module. The paired backend change adds saved generation configuration and reliable Agent terminal submission. Local-edit routing for continue-optimize is outside this change.

## Verification plan
- Backend focused handler/worker/stream tests: authorization, configuration persistence, history, requeue failure safety and stream restart.
- Frontend Vitest: classification, menu actions, prompt prefill, full/feedback regeneration and schedule independence.
- Run production build, i18n checks and diff checks.
- Browser: existing modal/Workflow stages/stream/sidebar; Agent edit/continue/schedule; zh-CN/en-US, light/dark, keyboard and constrained viewport.
- Before rollout, back up test data and verify compatibility with the backend `generation_requirement` migration; never reset user test data.
