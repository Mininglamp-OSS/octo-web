# Marketplace recruitment through capability installations

## Behavior list
- Existing expert and expert-team recruitment opens the same workspace/runtime
  picker and uses the capability installation route. No new entry is added.
- Send the selected Workspace ID and a per-operation idempotency key as headers;
  only the runtime ID belongs in the request body.
- Keep a failed operation's key for retries with the same target, including
  closing/reopening the dialog while it remains mounted. A successful subsequent
  recruitment is a new operation. Never fall back to the legacy installer.
- Preserve authentication, Space context, response validation and error UI.

## File map
- `packages/dmworkmcp/src/api/expertService.ts`: existing marketplace HTTP boundary,
  request headers, timeout, encoded plugin path and operation-key generation.
- `packages/dmworkmcp/src/components/ExpertAddToLoopModal.tsx`: operation lifecycle
  and protection against concurrent submissions.
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx`: keep the dialog mounted
  across open/close cycles so failed operation keys survive.
- Corresponding Service and modal tests: request contracts and retry behavior.

## PR scope
Only expert-marketplace recruitment changes. The existing axios Service boundary
is retained; migrating the module's shared networking architecture, new UI,
Skill naming, Fleet implementation and rollout activation are separate work.

## Verification plan
- Run the Service contract and modal retry tests, then the MCP package test suite.
- Build the web app and run the existing i18n check; no UI copy is introduced.
- Before deployment, deploy Fleet's nullable Skill-version installer/migration
  and the companion marketplace source-metadata change. A browser-to-Fleet
  deployment acceptance run is separate from these local mocked tests.

The new route is `POST /market/api/v1/plugins/{plugin_id}/installations`.
Headers: `X-Workspace-ID`, `Idempotency-Key`, existing login/Space headers.
Body: `{ "runtime_id": "<runtime UUID>" }`.
The response remains `{ "data": { "agent_id": "..." } }` for an expert or
`{ "data": { "squad_id": "..." } }` for a team.
The Service uses a 150-second timeout to cover Marketplace's bounded two-minute
Fleet operation. Stable retry keys are retained for the mounted dialog lifetime;
page reloads do not restore an uncertain operation automatically.

## CI bootstrap isolation follow-up

The first CI run passed all 209 main, 9 HTML-preview and 120 desktop cases, but
failed the no-proxy-leak gate on one chat categories bootstrap request during
RB1's document navigation. The categories MSW handler already exists; the gap
was that the fixture's page routes/events cannot see a retiring document's
Service Worker-owned network fallback.

The test fixture now observes context requests and registers worker-only context
fallbacks for the same two bootstrap GET endpoints, using the existing readiness
and start-time checks. The strict monitor exempts only exact request objects
successfully fulfilled by this fallback; later unhandled requests, unrelated
requests, error responses and network failures still fail. A forwarding worker on
an isolated local test origin verifies both ownership/readiness boundaries without
contacting Vite's dead backend. Production code and CI pass/fail rules are unchanged.
