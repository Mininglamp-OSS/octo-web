# New Module Development Guide

> Use this guide before adding a new business page, module, route entry, feature flow, or structured migration of an existing module.
> The goal is not to rewrite legacy code at once. The goal is to make new work land with consistent module ownership, Service boundaries, and UI/data separation.

## When To Read This

Read this guide before starting work that:

- Adds a business page, menu entry, route entry, or complete user flow.
- Adds functionality to an existing module and introduces API calls, state management, UI components, or user-visible entry points.
- Moves legacy code from `Components/`, `Messages/`, or `packages/dmwork*` into a clearer module structure.
- Changes shared components, base services, host routing, login state, Space handling, or message rendering in a way that can affect multiple modules.

Use it as reference, but not mandatory pre-work, for:

- Small style fixes, copy typos, or test assertion updates.
- Internal changes inside an existing Service that do not change its caller contract.
- Adding Story or i18n coverage to an existing component.

## Required Pre-Work

Before editing code, write the following four items in the issue, PR draft, or implementation note. If these cannot be written clearly, the implementation scope is not ready.

### 1. Behavior List

List what users can see, click, and trigger.

```md
## Behavior List
- Entry: where the flow starts, and whether it adds a menu, route, or button.
- Primary path: the shortest path for the user to complete the task.
- Empty/loading/error states: how each state is shown.
- Permissions/login/Space: whether the flow depends on current user, current Space, or admin permissions.
- Navigation: whether the target is an in-app route or a full-document navigation to another system.
```

### 2. File Map

List the files you plan to add or change, and the responsibility of each file.

```md
## File Map
- Service/XxxService.ts: HTTP boundary, endpoint construction, params, and response types.
- bridge/useXxx.ts: adapts Service data into UI state and actions.
- ui/XxxView/index.tsx: presentational component; does not call APIs.
- features/xxx/XxxPanel.tsx: business container that connects bridge and ui.
- i18n/*.json: user-visible copy.
- *.stories.tsx: isolated component verification.
- __tests__/*.test.tsx: Service, bridge, or key interaction tests.
```

### 3. PR Scope

Each PR should have one main line of work.

```md
## PR Scope
This PR does:
- ...

This PR does not do:
- ...

Impact:
- Current module only / shared component / routing or login state.
```

Do not combine Service migration, visual redesign, route refactoring, and unrelated legacy bug fixes in one PR. Shared-layer changes and business-layer changes are usually better split.

### 4. Verification Plan

The verification plan must be reproducible by another developer.

```md
## Verification Plan
- Automated tests: pnpm --dir ... exec vitest run ...
- Story: render the component in light/dark mode, including empty, long text, and error states.
- Manual path: enter from the user-visible entry, complete the primary flow, then refresh, go back, and switch Space if relevant.
- Regression points: list old behavior that must not change.
```

## Module Placement

New business capabilities should prefer this structure. Existing modules can migrate gradually; do not reorder all legacy code in one PR.

```text
packages/<module>/src/
  Service/                 # HTTP boundary
  bridge/                  # data bridge: types.ts + use*.ts
  ui/                      # presentational UI: index.tsx + index.css + stories
  features/                # business containers and local flows
  i18n/                    # module-owned copy
  __tests__/               # behavior tests
```

If the code must remain under `packages/dmworkbase/src` for now, still use responsibility-based placement:

```text
packages/dmworkbase/src/
  Service/XxxService.ts
  bridge/xxx/useXxx.ts
  ui/XxxLayout/
  features/xxx/
```

### Directories That Should Not Keep Growing

- `Components/`: existing shared components, compatibility work, or components that are genuinely reused across modules.
- `Messages/`: message rendering only.
- `Pages/`: existing page entries or thin containers, not complete business flows.
- `module.tsx`: module registration, entry wiring, and small adapters only; not page business logic.

## API / Service Rules

New or migrated API calls must be collected behind a Service boundary.

### Required

- Use `APIClient.shared` inside Service files.
- Name Service methods by business meaning, for example `getUserProfile` or `searchGlobalMessages`.
- Keep endpoint construction, query/body construction, response envelope compatibility, and response types inside the Service.
- UI, feature containers, and VMs call Service methods; they do not build raw API paths.
- Pass required runtime context such as Space, uid, or botId from the caller. Do not read global state inside the Service.
- Add at least one Service test for new Service methods, covering endpoint and key parameters.

### Forbidden

- Calling `WKApp.apiClient.get(...)` directly from UI components.
- Importing `WKApp` inside a Service to read global state.
- Passing the whole `WKApp`, router, or broad global objects into a Service.
- Changing business semantics during an API migration unless the PR explicitly documents and verifies that behavior change.

## Bridge / UI Separation

`bridge/` owns data and interaction state. `ui/` owns rendering.

### bridge should

- Call Services.
- Manage loading, error, empty, selected, pagination, and similar state.
- Convert API models into UI view models.
- Expose stable actions such as `reload`, `submit`, or `selectItem`.

### ui should

- Render from props.
- Not import Services.
- Not import `WKApp`.
- Not read route, Space, or login state.
- Not build API paths or run data requests.

Put the business container in `features/` or an existing page entry. The container connects bridge and ui.

## Routing And Entry Rules

The host app uses clean URLs. New code must not expose `sid` in route URLs.

### In-App Module Entries

- Give each module route a clear `routePath`.
- Use the existing host route mechanism to sync menu state and URL state.
- Direct route load, refresh, browser Back, and browser Forward should work.
- If query or hash values are deep-link parameters, capture them before route normalization and persist them in module-owned state.

### External Or Standalone Entries

Standalone systems must not be folded into the host router.

Example:

- `/space` is a standalone Space management entry and uses full-document navigation.
- Do not use `WKApp.route.push("/space")`.

### Forbidden

- Adding new `?sid=` route URLs.
- Registering an external system as a host route just to make navigation easier.
- Exposing two user-visible entries for one business capability.

## UI, Theme, i18n, And Story Rules

### UI

- Put new reusable UI components under `ui/` and generate them with `pnpm gen:component` when applicable.
- Write Story coverage before wiring the component into business code.
- Use tokens for size, color, spacing, radius, and text styles.
- Do not override Semi internal classes directly. Do not use `!important`.

### i18n

- User-visible copy must go through i18n.
- Before changing multilingual UI or copy, read `docs/i18n-agent-guide.md`.
- Run the relevant i18n check after changing copy.

### Story

New UI components should include Story coverage for:

- Default state.
- Empty state.
- Loading state.
- Error state.
- Long text or extreme data.
- Light and dark themes.

## PR Acceptance Checklist

Before opening a PR, check:

- The four required pre-work items are complete.
- There is only one user-visible entry for the capability.
- New or migrated API calls are behind a Service.
- UI does not build API paths directly.
- New user-visible copy goes through i18n.
- New UI has Story coverage, or the PR explains why it does not need it.
- The PR describes the impact area: current module, shared layer, routing, login state, Space, or message rendering.
- The verification commands and manual path are reproducible.

Suggested PR description:

```md
## Summary
- ...

## Scope
- ...

## Out of scope
- ...

## Risk areas
- ...

## Verification
- ...
```
