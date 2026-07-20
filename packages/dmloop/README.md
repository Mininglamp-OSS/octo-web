# @octo/loop Module Notes

This package owns the Loop workspace experience: issues, projects, automations,
agents, squads, workspace settings, CLI authorization, and shared Loop runtime
helpers.

## Current Entry Points

- `src/module.tsx` registers the `/loop` route and the Loop navigation entry.
- The navigation entry is controlled by `WKApp.remoteConfig.dmloopOn`.
- The route remains registered even when the navigation entry is hidden.
- `src/pages/LoopPage.tsx` is the left-pane container for the Loop workspace
  shell. It should stay thin.

## Directory Boundaries

- `src/api/` is the current Loop Service boundary. It owns HTTP calls, endpoint
  construction, workspace context helpers, cache invalidation helpers, and API
  model types.
- `src/bridge/` owns runtime state that connects the host app to Loop UI:
  workspace resolution, Space switching, shared right-pane writes, create-modal
  state, and tab actions.
- `src/ui/` owns presentational UI and UI-only helpers. UI files must not call
  Loop APIs, write `WKApp.routeRight`, or resolve workspace context.
- `src/pages/` owns route/page containers. A page may compose bridge state and
  UI, but should not grow new API calls or large interaction state directly.
- `src/panel/` contains existing feature panels and detail views. These can be
  migrated gradually; do not move all legacy code in one PR.
- `src/i18n/` owns user-visible Loop copy.

## Current Standardization Status

`LoopPage` has been split into:

- `src/pages/LoopPage.tsx`: thin page container and tab renderer.
- `src/bridge/useLoopWorkspace.tsx`: workspace selection, Space re-resolution,
  shared `routeRight` updates, workspace creation, and create-issue shell state.
- `src/bridge/types.ts`: tab and bridge helper types.
- `src/ui/LoopSidebarView.tsx`: pure sidebar rendering.
- `src/ui/LoopCreateWorkspaceModal.tsx`: pure create-workspace modal rendering.
- `src/ui/LoopWorkspaceEmptyState.tsx`: pure empty-state rendering.

The key behavior to preserve is the Space-switch guard:

- Clear the old workspace context before re-listing workspaces.
- Ignore stale async responses with the resolve sequence guard.
- Do not write the shared right pane when Loop is backgrounded.
- Gate sidebar actions while `loaded` is false.
- Close create modals during Space re-resolution.

## Rules For Future Changes

- New Loop API calls should go in `src/api/` first. Pages and UI should not build
  raw API paths.
- New reusable views should go in `src/ui/` and include Story coverage.
- New runtime state or host-app coordination should go in `src/bridge/`.
- Keep one visible entry per user capability. Do not add duplicate menu or route
  entries while refactoring.
- Preserve the route/right-pane behavior on refresh, direct route load,
  navigation reactivation, and Space switching.

## Known Remaining Work

- Several feature pages under `src/pages/` still mix data loading, local state,
  and rendering. Migrate them gradually, one feature path per PR.
- `src/api/` already acts as the Service boundary, but it has not been renamed
  to `Service/`. Treat renaming as a separate architecture decision.
- `src/panel/` still contains legacy feature panels. Prefer focused migrations
  over broad directory reshuffles.
- Private/module extraction is not part of the current standardization work.
  Keep new changes structurally clean so extraction remains possible later.

## Verification

For Loop shell changes, run:

```bash
pnpm --dir apps/web exec vitest run src/__tests__/personalPageSpaceChanged.test.ts
pnpm exec vitest run packages/dmloop/src/api/__tests__/workspaceSelection.test.ts packages/dmloop/src/api/__tests__/issueFilterQuery.test.ts packages/dmloop/src/api/__tests__/issueGrouping.test.ts packages/dmloop/src/pages/__tests__/runtimeVersion.test.ts packages/dmloop/src/pages/__tests__/headlessCommand.test.ts packages/dmloop/src/ui/__tests__/slug.test.ts packages/dmloop/src/ui/__tests__/attachmentSrc.test.ts packages/dmloop/src/ui/__tests__/downloadAttachment.test.ts packages/dmloop/src/ui/__tests__/objectUrl.test.ts packages/dmloop/src/ui/__tests__/threadReplies.test.ts packages/dmloop/src/ui/__tests__/cliCallback.test.ts packages/dmloop/src/ui/__tests__/attachmentPreview.test.ts
pnpm --dir apps/web build
pnpm --dir apps/web build-storybook
```
