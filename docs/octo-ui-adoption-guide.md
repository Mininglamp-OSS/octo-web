# Octo UI Adoption Guide

This guide is for two recurring tasks:

- building shared components in `packages/octo-ui`
- gradually replacing Semi, `dmworkbase`, and wk-style shared UI usage with `@octo/ui`

It complements `DEVELOPMENT.md`. When the two documents overlap, follow the stricter rule for the package you are touching.

## Goals

- Make `@octo/ui` the stable shared UI boundary for basic interactive components.
- Keep business packages from depending directly on Semi primitives where an Octo UI equivalent exists.
- Keep new shared components independent from wk implementation details so wk components can be removed later.
- Migrate gradually without changing unrelated business behavior in the same PR.

## Before Starting

For every shared component or migration PR, write down:

- Behavior List: states, interactions, accessibility, keyboard behavior, and compatibility behavior.
- File Map: exact files to add or edit.
- PR Scope: what is included and what is intentionally deferred.
- Verification Plan: unit tests, build commands, Storybook checks, and affected business checks.

Do this before editing code when the work affects `@octo/ui`, existing shared components, or multiple business packages.

## Layer Rules

`@octo/ui` is the shared UI boundary for base interaction primitives.

- Layer 1 primitives live in `packages/octo-ui/src/components/*`.
- Layer 1 may wrap Semi or native DOM, but exposes Octo-owned props and CSS classes.
- Layer 1 must not import business packages, routing, stores, IM SDKs, services, or app-specific data models.
- Layer 2 composed components should use `@octo/ui` instead of direct Semi primitives when an equivalent exists.
- Layer 3 business components may remain unchanged during staged migration, but new direct Semi primitive usage should be avoided.

Do not force components with different behavior into one primitive only to reduce file count. Shared UI should unify semantics, not hide incompatible workflows.

## Component API Rules

Prefer an Octo-owned API first, then add narrow compatibility only when it removes migration risk.

- Props are named with `ComponentNameProps`.
- Export both default and named component exports.
- Keep props small and explicit; if a primitive needs too many options, split the behavior or defer the variant.
- Prefer native DOM semantics for form controls and buttons when possible.
- Preserve `ref` forwarding for interactive primitives.
- Keep event naming consistent inside `@octo/ui`; for boolean controls prefer `onCheckedChange(value, event)` while still allowing native `onChange` where useful.
- Do not expose Semi-only concepts as the primary API unless the component is intentionally a compatibility adapter.
- Avoid passing full business objects into shared components. Pass only display data and event handlers.

For migrations, adapter wrappers are allowed as an intermediate step. The final target should still be direct use of `@octo/ui`, not a permanent second component API.

## Theme And Token Rules

`packages/octo-ui` owns its public token boundary.

- Component CSS must use `--octo-ui-*` variables.
- Component CSS should not directly use `--wk-*`.
- If a value must temporarily follow the host wk theme, put the fallback in `packages/octo-ui/src/styles/tokens.css`, for example `--octo-ui-button-text: var(--wk-text-primary, ...)`.
- Keep token names component-scoped when the value is not a global primitive, for example `--octo-ui-checkbox-border`.
- Do not define new color variables inside a component CSS file.
- Do not hard-code light or dark colors in component CSS.
- Do not use `@media (prefers-color-scheme: dark)` for component theme logic.
- Do not directly override Semi class names from business CSS.

This is important for wk removal: business packages may still provide wk variables during migration, but `@octo/ui` components must not make wk variables part of their own component contract.

## File Structure

Use the existing `@octo/ui` component shape:

```text
packages/octo-ui/src/components/ComponentName/
  index.tsx
  types.ts
  index.css
  ComponentName.stories.tsx
  ComponentName.test.tsx
```

Then wire the component through:

```text
packages/octo-ui/src/index.ts
packages/octo-ui/src/styles/components.css
packages/octo-ui/src/styles/tokens.css
```

Only add extra files when the component has real internal complexity.

## Storybook Rules

Write Story coverage before business migration.

Stories should cover:

- default state
- all intended variants and sizes
- hover, active, focus-visible, disabled, loading, checked, selected, or error states where applicable
- long text or narrow layout cases
- light and dark theme verification
- controlled and uncontrolled examples for form controls

Storybook is the visual contract for shared components. Do not claim a shared UI migration is done only from unit tests.

## Test Rules

Shared interactive components need focused tests.

Cover:

- render output and exported class names that consumers rely on
- click and keyboard behavior
- disabled behavior
- controlled and uncontrolled state behavior
- aria attributes and native semantics
- compatibility callbacks when a migration adapter exists

Avoid snapshot-only tests for shared primitives. They rarely catch the regressions that matter here.

## Migration Strategy

Use small, reviewable PRs.

1. Add the `@octo/ui` primitive with Story, tests, tokens, and exports.
2. If an old shared component already exists, convert it into a narrow adapter over `@octo/ui` while preserving its public API.
3. Replace low-risk business call sites that already match the new semantics.
4. Replace higher-risk call sites in separate PRs with focused manual checks.
5. Remove obsolete wrappers, CSS, and imports only after the last known consumer is gone.

Do not combine a new primitive, a large business migration, and old implementation deletion in one PR unless the component has very few consumers and the verification is trivial.

## Semi Usage During Migration

When an `@octo/ui` equivalent exists:

- new shared or business code should import from `@octo/ui`
- existing direct Semi primitive imports should be replaced gradually
- Semi can remain inside `@octo/ui` implementation if it is intentionally used as the low-level behavior base

When no `@octo/ui` equivalent exists:

- Layer 3 business code may keep direct Semi usage temporarily
- do not create a one-off wrapper in a business package just to hide the import
- record the missing primitive if the same pattern appears in multiple places

Semi service components such as notifications or modals can be handled separately from base interaction primitives.

### Select

Use `@octo/ui/select` for ordinary single-value and multiple-value pickers.

- Prefer `optionList` for static options and `Select.Option` only when an existing call site already uses child options.
- Keep option values to stable `string` or `number` identifiers.
- Use `placeholder`, `disabled`, `emptyContent`, `clearable`, `multiple`, and `loading` for common form states.
- `onChange` intentionally exposes the normalized value only; use `onSelect` when the selected option metadata is needed.
- Do not import Semi `Select` directly outside `packages/octo-ui/src/components/Select`.
- Do not migrate business selectors such as contact pickers, conversation pickers, or search panels unless their behavior already matches the base Select contract.

## wk Component Usage During Migration

wk and `dmworkbase` shared components are legacy source material, not the long-term public API.

- Read old components to preserve behavior and migration compatibility.
- Do not copy wk class names into new `@octo/ui` components.
- Do not make new `@octo/ui` props match old wk props unless there is a clear migration need.
- Prefer an adapter at the old component path when many call sites still import it.
- Delete the adapter only when scans confirm no remaining consumers.

If a component was hand-written inside a business feature and does not use Semi or old shared wk components, leave it alone unless the task explicitly includes that feature.

## Accessibility Baseline

Every interactive primitive must define its semantic behavior before styling.

- Use native elements when possible: `button`, `input`, `label`, `a`.
- Preserve keyboard behavior without custom JavaScript when native behavior is enough.
- Use `aria-*` only to supplement native semantics, not to recreate avoidable custom controls.
- Keep focus-visible styles clear in light and dark themes.
- Ensure disabled controls cannot trigger action callbacks.
- For grouped controls, define name, role, labeling, and selection semantics explicitly.

## CSS Boundaries

Use component-owned classes:

```css
.octo-ui-component-name { }
.octo-ui-component-name__part { }
.octo-ui-component-name--variant { }
```

Avoid:

- global selectors
- host app selectors
- Semi class overrides
- `!important`
- hard-coded z-index scales without a token or documented need
- layout assumptions about business containers

Shared primitives should size themselves predictably and let the caller decide placement.

## Verification Commands

Use Corepack from this repo.

```bash
corepack pnpm --filter @octo/ui typecheck
corepack pnpm --filter @octo/ui test
corepack pnpm --filter @octo/ui build
corepack pnpm exec stylelint "packages/octo-ui/src/**/*.css" --config stylelint.ci.config.mjs --allow-empty-input
git diff --check
```

For business migrations, also run the smallest relevant package tests and manually verify the touched flow.

Storybook startup from `apps/web`:

```bash
corepack pnpm --filter @octo/ui build
cd apps/web
./node_modules/.bin/storybook dev -p 16006 --ci
```

## PR Checklist

Before opening or updating a PR:

- The PR scope is narrow and matches the title.
- New shared components have Story and tests.
- Public exports and CSS imports are wired.
- Tokens are `--octo-ui-*` at component usage sites.
- No new direct Semi primitive imports were added outside `@octo/ui`.
- No new `wk-` class names or direct `--wk-*` component CSS usage were added in `@octo/ui`.
- Light and dark Storybook states were checked.
- A scan was run for old imports if the PR claims migration progress.
- The PR description lists deferred migration work separately from completed work.
