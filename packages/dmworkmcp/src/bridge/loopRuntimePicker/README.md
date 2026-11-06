# Market installation runtime picker

Entry: the existing expert/team “Add to Loop” dialog. Both installations use the
same picker and continue to submit the full runtime ID. Every open/workspace
change starts on Mine. Only the owned response can supply an automatic default.

- `api/expertService.ts` keeps the workspace-scoped `owner=me` request for Mine and omits `owner`
  for All. Cache keys include workspace and scope; All loads on demand.
- `model.ts` derives machine groups and configuration labels. `daemon_id` is the
  machine identity, scoped by owner; missing daemon IDs fall back to separate
  runtime IDs, never to hostname. Short-ID collisions expand until distinct.
- `ui/LoopRuntimePicker` renders props only, including empty/loading/error states,
  machine headings, versions, visibility, disabled configuration diagnostics,
  selected identity and keyboard navigation.
- `components/ExpertAddToLoopModal.tsx` owns fetching and installation. Default
  selection and submission share `isRuntimeReady`: explicit non-owned runtimes
  and failed profile registrations are rejected, including when status is online.
  Missing status/ownership flags retain the older Fleet compatibility behavior.

Mine/All is a controlled view filter. Switching to All preserves a valid selection
without selecting its first row; returning to Mine clears any shared selection.
All responses are ignored after scope/workspace/item changes. A failed All request
shows an error with no selectable stale results; switching tabs allows retry.

Ownership is confirmed by the Mine response (`owner=me`), with explicit
`can_bind=false` rejected. `owner_id` is a Fleet user ID, so it is not compared to
an IM UID. `can_bind` is owner-only, not a complete permission result. On All,
`visibility=workspace` plus an explicit ready status permits manual selection;
private or unknown-visibility rows without confirmed ownership are disabled.
No administrative override is inferred because no role/permission field for that
policy is present in this response. Failed profile configurations stay disabled.
The backend remains the final installation authority.

Provider logos use only `provider`; unknown values fall back to a generic icon.
Visibility/version/diagnostics render only when supplied. The picker never guesses
ownership or a brand from runtime names.
Runtime version comes from `metadata.version`, then `device_info`, then
`launch_header`; daemon `metadata.cli_version` is not an agent runtime version.

## Verification

From the repository root:

```sh
pnpm --filter @dmwork/mcp exec vitest run src/api/expertService.addToLoop.test.ts src/components/ExpertAddToLoopModal.test.tsx src/components/__tests__/ExpertAddToLoopModal.runtime.test.tsx src/components/__tests__/ExpertAddToLoopModal.selection.test.tsx src/bridge/loopRuntimePicker/model.test.ts
pnpm i18n:check
pnpm exec stylelint packages/dmworkmcp/src/ui/LoopRuntimePicker/index.css --config stylelint.config.mjs
```

Storybook: `Marketplace/LoopRuntimePicker`, in light/dark and zh-CN/en-US. Check
same-hostname machines, long names, loading/empty/error, expand unavailable
configurations, choose the other Codex and verify the trigger's machine changes.
Arrow keys/Home/End navigate available rows; Escape returns focus to the trigger.

Integration regressions cover exact submitted IDs, one selected row, unavailable
rows, reopening after status changes, workspace changes and installation retries.
Live deployment acceptance still needs an authenticated marketplace installation.
