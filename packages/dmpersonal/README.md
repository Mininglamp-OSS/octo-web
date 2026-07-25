# @octo/personal Module Notes

This package owns the Personal workspace entry. It currently exposes the
personal runtime and skill views by reusing Loop runtime pages.

## Current Entry Points

- `src/module.tsx` registers the `/personal` route and the Personal navigation
  entry.
- The navigation entry is controlled by `WKApp.remoteConfig.dmpersonalOn`.
- The route remains registered even when the navigation entry is hidden.
- `src/PersonalPage.tsx` is the Personal left-pane container. It should stay
  thin.

## Directory Boundaries

- `src/bridge/` owns runtime state and host-app coordination: workspace
  resolution, machine/workspace mode, Space switching, shared right-pane writes,
  and tab actions.
- `src/ui/` owns presentational UI only. UI files must not call APIs, import
  `WKApp`, write `routeRight`, or resolve workspace context.
- `src/PersonalPage.tsx` composes bridge state, i18n labels, and UI components.
- `src/i18n/` owns user-visible Personal copy.

## Current Standardization Status

`PersonalPage` has been split into:

- `src/PersonalPage.tsx`: thin page container and tab renderer.
- `src/bridge/usePersonalWorkspace.tsx`: workspace selection, machine mode,
  Space switching, shared `routeRight` updates, and tab actions.
- `src/bridge/types.ts`: Personal tab and workspace-state render types.
- `src/ui/PersonalSidebarView.tsx`: pure sidebar rendering.
- `src/ui/PersonalWorkspaceState.tsx`: pure loading/error state rendering.

The key behavior to preserve is the Personal/Loop shared workspace isolation:

- Personal stores its own selected workspace instead of blindly following Loop's
  latest workspace.
- Personal clears its own state on Space changes.
- When Personal is backgrounded, it must not clear the shared Loop workspace
  context or write the shared right pane.
- Machine mode disables the Skill tab and clears workspace-scoped HTTP context.

## Current Dependency On Loop

Personal intentionally imports from `@octo/loop` today:

- `RuntimePage`
- `SkillPage`
- workspace selection helpers and workspace context helpers
- Loop CSS used by the reused runtime/skill pages

Do not remove this dependency casually. If Personal runtime/skill behavior needs
to become independent later, split that as a separate PR with its own behavior
list, file map, PR scope, and verification plan.

## Rules For Future Changes

- Keep UI rendering under `src/ui/`; add Story coverage for new UI components.
- Keep host-app coordination and workspace state under `src/bridge/`.
- Do not add direct API calls or `WKApp.routeRight` writes to
  `src/PersonalPage.tsx` or `src/ui/`.
- Preserve direct route load, navigation reactivation, and Space switching.
- Private/module extraction is not part of the current standardization work.
  Keep new changes structurally clean so extraction remains possible later.

## Verification

For Personal shell changes, run:

```bash
pnpm --dir apps/web exec vitest run src/__tests__/personalPageSpaceChanged.test.ts
pnpm --dir apps/web build
pnpm --dir apps/web build-storybook
```
