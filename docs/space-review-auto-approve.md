# Space review auto approval UI

## Behavior List

- Space owners and admins see the automatic-review setting on Publication management.
- The switch is on when no override exists; turning it off asks for confirmation.
- Space owners and admins may use the review queue and change the shared setting.
- Space changes reload both the role and policy; stale Space payloads cannot supply the current role.
- Space profile editing and invitations are available to admins and owners; disbanding and role assignment remain owner-only.
- Member removal follows the server hierarchy: admins remove ordinary members, owners remove admins or ordinary members, and nobody removes themselves or an owner here. Success is shown only after the authoritative roster confirms removal.
- A pending review submission or decision cannot close another target's dialog or overwrite state after a Space switch. Failed rejection keeps the reason and error visible.
- Queue action errors survive reconciliation; failed later pages retain loaded rows, stop automatic pagination, and expose explicit retry.
- Member removal requires a named danger confirmation and revalidates the Space, target and permissions before writing.
- A decision owns its pending lock independently of mutable global Space state; silent Space changes cannot strand the drawer or let an old operation unlock a new one.

## File Map

- `packages/dmworkskillmarket/src/api/skillApiReal.ts`: policy wire calls.
- `packages/dmworkskillmarket/src/pages/SpaceReviewPage.tsx`: owner/admin setting UI.
- `packages/dmworkskillmarket/src/i18n/*.json`: user-facing copy.
- `packages/dmworkskillmarket/src/index.css`: setting presentation.
- `packages/dmworkskillmarket/src/hooks/useSpaceRole.ts`: current-Space role resolution.
- `packages/dmworkbase/src/Components/SpaceSettings` and `SpaceMembers`: server-aligned profile/member gates.
- `packages/dmworkbase/src/Service/SpaceService.tsx` and `packages/dmworkcontacts/src/Contacts`: role encoding and badges.
- `packages/dmworkmcp/src/components/{ReviewSubmitModal,ExpertEditModal,McpCreateModal}.tsx`: guarded authoring/submission continuations.
- `packages/dmworkskillmarket/src/components/ReviewDetailDrawer.tsx`: guarded decisions and durable rejection errors.
- Adjacent component/hook tests and `apps/web/e2e-kit`: permission, race, policy, and integration regressions.

## PR Scope

#1624 is the sole landing PR for the complete review workflow originally proposed
in #1614 and resubmitted as #1649/#1650; those duplicate PRs are closed unmerged.
The consolidated scope includes that workflow, policy API/UI, shared Space role encoding and permission gates,
contacts role badges, and Space/target isolation across review and authoring dialogs.
The shared profile panel admits both admins and owners, matching the existing server
contract; destructive owner-only operations retain that restriction. Authorization
and policy default resolution remain server-side. The current review-fix pass covers
member-removal truthfulness, modal continuation isolation, rejection feedback, and
the directly related role-payload and scope-documentation corrections.

## Verification Plan

- API mapping tests and owner/admin page interaction tests.
- Member role matrix, server no-op, readback failure, and stale-Space completion tests.
- Submission/decision success and failure after target switches, repeated IDs, Space switches, and unmount.
- Failed-reject feedback and cancellation guards; queue refresh after a completed same-Space decision.
- Emit-less Space changes before/during detail reads and decisions; stale finalizers after reopening with a new in-flight action.
- Queue approve/cancel errors through reconciliation, driven-observer pagination failures and manual recovery, and multi-row duplicate actions.
- Member-confirmation cancel/accept, permission/session changes while confirming, and initial roster retry.
- Affected package suites, focused browser regressions, production build, and `pnpm i18n:check`.

## Follow-up review observations

Non-blocking observations from the #1614/#1624 review rounds are tracked in
[follow-up issue #1652](https://github.com/Mininglamp-OSS/octo-web/issues/1652).
The remaining groups are separate from this focused correction:

- Skill upload cancellation/session isolation, unsaved-change coverage, and save-success/publish-failure reconciliation inherited from the base review workflow.
- Page-level mutation toasts and synchronous duplicate-action guards.
- Unknown review counters, version-helper consolidation, and connector probe lifecycle.
- Policy/enum boundary validation and remaining shared-review import assumptions.

These entries record outstanding work; they do not claim those behaviors are fixed.
