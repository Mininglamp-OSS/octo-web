# Loop workspace creation is not tenant Space creation

`workspace_created` in this change measures the Loop workspace switcher's **Create workspace** action. It does not measure the host's **Create Space** action.

## Source chain

Read-only audit of `dmwork/octo-web-enterprise/octo-loop-module` at `31ecd5ff223c0ecf20b63eb196204b31b887c591` (fetched `origin/main`):

1. `packages/dmloop/src/bridge/useLoopWorkspace.tsx`, `submitCreateWorkspace` calls `createWorkspace({ name, slug: "" })`.
2. `packages/dmloop/src/api/workspaceApi.ts`, `createWorkspace` calls `ProjectService.createProject(WKApp.shared.currentSpaceId, ...)`. The module explicitly documents Project-backed workspace identity.
3. Independent browser evidence from im-test: submitting **Loop -> workspace switcher -> Create workspace** issued `POST /api/v1/space/minglue_default/projects`, CDP requestId `3995593.195`, HTTP 200. The created unique self-test workspace then appeared in the sidebar.

In contrast, host `packages/dmworkbase/src/Components/SpaceCreate/index.tsx` calls `SpaceService.shared.createSpace(...)`, which posts `space/create` in `SpaceService.tsx`. That creates a tenant Space and an invite, not a Loop workspace inside the current Space. It must not produce `workspace_created` merely because its HTTP request succeeded.

The host OSS checkout does not itself contain the enterprise Loop creation component. Inspecting only SpaceService therefore does not establish the Loop module's creation endpoint. The source revision above and the deployment capture are distinct evidence layers; we do not claim that the deployed module revision is identical to the fetched source revision.

## Regression evidence

`Service/__tests__/fixtures/workspaceCreated.im-test.json` preserves only allowlisted metadata from that observed business request (entrypoint, method, pathname, status, CDP requestId) and source-audit provenance. It contains no auth headers, cookies, request body, user name or created workspace identifier.

The matcher and actual DAP HTTP wrapper tests replay that recorded route rather than inventing a different URL. The wrapper's fetch transport is stubbed: this is a **hermetic regression replay**, not new live UI or collector verification. Tests also assert that a successful `/api/v1/space/create` request does not generate the Loop event. Existing failure, cross-origin, list and legacy-compatibility boundaries remain in force.

The legacy Fleet route remains an intentionally registered compatibility alias. One successful request selects one matching event; this is not action-level deduplication across two separate successful API calls.

## Release boundary

No backend or enterprise-module change is included. No merge or deployment is authorized by this PR. Post-deployment real UI -> collector requestId + HTTP status + final payload and DAP downstream verification remain separate gates.
