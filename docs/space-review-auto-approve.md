# Space review auto approval UI

## Behavior List

- Space owners see the automatic-review setting on Publication management.
- The switch is on when no override exists; turning it off asks for confirmation.
- Admins may use the review queue but do not see the owner-only setting.
- Space changes reload both the role and policy.

## File Map

- `packages/dmworkskillmarket/src/api/skillApiReal.ts`: policy wire calls.
- `packages/dmworkskillmarket/src/pages/SpaceReviewPage.tsx`: owner setting UI.
- `packages/dmworkskillmarket/src/i18n/*.json`: user-facing copy.
- `packages/dmworkskillmarket/src/index.css`: setting presentation.

## PR Scope

Only the skill-market review-management page and its marketplace API boundary.
Authorization and default resolution remain server-side.

## Verification Plan

- API mapping tests and owner/admin page interaction tests.
- Skill-market Vitest suite and `pnpm i18n:check`.
