# Docs Client Forward Bridge

## Behavior List

- Reuse the existing Docs "forward to chat" entry and the communication artifact's
  conversation picker. Do not initialize a second IM connection in the Docs artifact.
- Docs owns document metadata, the canonical link, permission checks and the
  existing forward-grant batch API. Communication owns target/member selection,
  opt-in grants, type-18 cards or instruction text, sending and result feedback.
- The Client carries typed requests between isolated renderers. It binds every
  operation to the originating document, authenticated principal and selected
  organization. Document home space is metadata, never an authorization override.
- A cancelled, closed or revoked source must not authorize or send later. Ordinary
  grant failures remain nonfatal, as in Web; invalidated operations are different
  and must stop before further side effects.
- Host visibility is not source validity. Page transitions, layout remounts and
  overlays may suspend/resume the same communication view without cancelling its
  picker. Explicit cancellation, source teardown, changed account/organization
  and actual communication disposal still invalidate it.
- The existing Web entry remains supported without Client bridge methods. A Docs
  artifact without a compatible host must not expose its local, disconnected
  conversation picker as a usable forwarding capability.

## File Map

- `packages/dmworkbase/src/Components/ForwardModal/grant.ts`: optional scoped
  forwarding lifecycle hooks on the existing contract.
- `packages/dmworkbase/src/Components/WKBase/index.tsx`: reuse existing selection
  and send orchestration, with scoped cancellation and side-effect checks.
- `apps/web/src/client-communication/*`: typed Docs request adapter, grant
  round trips, cancellation and capability reporting.
- Client `electron/main/docs/*` and `electron/main/communication/*`: validate
  payloads, bind source identity, manage pending requests and forward grants.
- Client preloads and embedded feature controller: expose only explicit bridge
  operations and present the existing communication view.
- Docs `src/client-docs/*` and `src/octoweb/index.ts`: opt-in host adapter;
  ordinary Web fallback remains unchanged.
- Tests beside each boundary: execute production implementations with isolated
  transport dependencies, not duplicated implementations of the tested logic.

## PR Scope

The change completes forwarding from the extracted Docs workspace. It does not
change backend endpoints, document authorization rules, the Web navigation
model, editor engines or release publishing. Shared changes are limited to the
existing conversation picker and document-forward lifecycle, with regression
tests for ordinary Web callers.

This note is a development plan, not an assertion of completed integration.
The Web baseline is `2a41ee1d` (upstream #1640); pre-existing voice compatibility
changes remain separate and must be preserved.

## Verification Plan

- Web: actual WKBase/forward tests for ordinary callers, cancel/replacement,
  async grant invalidation, per-target send guard, and card/text behavior.
- Docs: actual bridge/runtime tests for unavailable host, read-only policy,
  request/result/grant lifecycle and revoked sessions.
- Client: trusted sender, immutable document target, source teardown, login and
  organization changes, timeout, rejected grant, and pending request cleanup.
- Build new real communication and Docs artifacts into isolated directories.
  Never claim a newly added bridge works with an old artifact.
- Run real Electron integration against local HTTP/IM fixtures. Grant opt-in,
  cancel and card delivery must be observable. This does not replace authorized
  online collaboration acceptance.
- Do not restart the user's live Client or write to production documents while
  running these checks.
