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

## CR follow-up

- Scheduling uses a single task/Space-scoped navigation intent, consumed after the
  target detail and any existing schedule load. There is no fixed-delay event;
  task switches clear old detail/dialog state and writes check task identity.
- The presence of the backend's always-emitted `generation_requirement` string
  advertises the paired configuration contract. Older backends omit it: new Agent
  full regeneration/scheduling is guarded with upgrade feedback, while existing
  feedback refinement stays available. Deploying the backend first is still preferred.
- Only single-person full regeneration and schedule configuration collect missing
  shared scope. Collaboration/team regeneration retains its existing scope and
  never requests inputs its endpoint would discard. Workflow prefill falls back
  to topic/title when the saved requirement is empty.
- Saved Agent requests retain the chat's 8192-rune limit, including emoji, rather
  than being cut down to the ordinary Workflow input limit. Dead engine-specific
  props/styles/locale keys were removed and the Agent-save E2E now expects the
  unified success message and engine-neutral detail.

## CR follow-up — 2026-09-14

- Edit, regeneration and failure retry reuse the schedule navigation-intent
  mechanism. An intent is recorded before navigation and consumed once for the
  matching task/Space after its required data loads. Retry needs only detail,
  not an existing personal result, and both entries select full regeneration.
  Old backends show upgrade feedback instead of opening an unusable retry dialog.
- Personal collaboration regeneration no longer fabricates shared title/topic or
  schedule-instruction changes that its endpoint does not persist. Agent titles,
  including the breadcrumb, stay separate from generation instructions.
- Failed personal summaries retain their previous body and show metadata once.
  Inline and list edit paths share content/permission/terminal-state checks;
  personal editing honors `can_edit_personal` (including retained failed or
  cancelled reports), falling back to `can_edit` only if older servers omit it.
  An explicit personal permission denial is never overridden.
  absent content, missing permission and in-flight generation cannot mount an
  invisible editor. The real header schedule menu is covered by tests; the unused
  standalone schedule renderer was removed.
- Full Agent input retains the 8192-code-point limit; ordinary/refine input keeps
  its existing UTF-16 limit, with matching counters and voice/text truncation.
  Source-type conversion is shared and rejects unsupported types.
- Configuration persistence records `smart_summary_generation_config_saved`
  only after an accepted envelope. No prompt/source contents are included, and
  it is not counted as timer creation or regeneration.
- Team full regeneration remains creator-only, matching backend authorization.
  Participant-specific collaboration actions and continue-optimize are unchanged.
  Shared schedule configuration remains creator-authorized for multi-person
  tasks; regeneration itself does not collect unsupported shared scope.

The paired backend still deploys first. If its environment uses an external
`AGENT_PROMPT_DIR/summary_workspace.md`, update/remove that override with the
backend release. This change does not deploy either service or update a mirror.

## Citation consistency follow-up

- Saved detail and historical-version rendering reuse `CitationText`. Verified
  numeric lists/ranges are normalized to the existing adjacent-marker form;
  every member must have citation metadata and groups are bounded at 128 entries.
- Display indices follow first appearance: raw `[9,73]`, then `[88]`, then `[9]`
  render as `[1,2]`, `[3]`, `[1]`. Clicking retains the original message identity.
- Missing sources do not create fake buttons or consume display indices. Code,
  link labels and destinations are not treated as citation-bearing prose.
- No conversation-preview contract/UI change, historical data rewrite or
  deployment is included. Existing incomplete rows remain incomplete until a
  separately authorized data repair.
