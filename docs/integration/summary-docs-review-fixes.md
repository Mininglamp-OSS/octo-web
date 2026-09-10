# Summary Docs Review Fixes

## Behavior List

- Keep the existing conversion action and normal Web popup behavior.
- Show retained document links only after validation against a trusted origin
  captured before conversion, including rejected bridge promises.
- Keep account, token and Space guards. Display the validated URL as selectable
  text for manual recovery; never retry under a newly captured identity.
- Normalize valid host origins and diagnose malformed advertised capabilities
  without logging credentials or treating a disabled capability as an error.
- Use `create_unconfirmed` for post-create scope/link failures, without exposing
  stale or invalid document links or inviting a duplicate creation.
- On retained-document failures, preserve known error reasons but omit the
  generic retry prompt so it cannot contradict the recovery guidance.

## File Map

- `packages/dmworkbase/src/bridge/docs/documentLink.ts`: pure shared validation.
- `apps/web/src/client-summary/docsAdapter.ts`: bridge result/error validation,
  origin normalization, boundary diagnostics and runtime argument checks.
- `packages/dmworksummary/src/utils/convertDocError.ts`: retained-link validation.
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx`: capture the trusted
  origin before conversion and display only validated fallback links.
- Summary styles/locales: wrapping and manual-recovery copy for retained URLs.
- Focused tests, integration contract and CI: rejected/malformed/stale cases,
  capability lifecycle documentation and real client-summary build coverage.

## PR Scope

Review fixes for #1654 only. Shared validation affects the Client adapter and
Summary conversion fallback, not general document links or private Docs REST.
No Client pin, credentials or installed application changes are included.
Delivery updates the existing #1654 head branch, not a replacement PR.
Keep install-time identity binding; token refresh requires renderer recreation.

## Verification Plan

- Base document validation and Docs port tests.
- Web adapter/bridge tests, including hostile rejected errors and stale scopes.
- Summary error/flow tests and the full Summary suite.
- Internationalization, whitespace and targeted lint checks.
- Build the actual client-summary entry with non-mock settings and verify its
  manifest; run the Web suite to check the shared exports.

## Local Verification (2026-09-10)

- Initial verification used isolated branch `fix/summary-docs-review-1654`,
  rebased onto upstream `a29b1fec`, before integration into the existing PR
  branch `fix/summary-docs-main-alignment`.
- Base: 481 files, 4,573 tests passed. Summary: 83 files, 1,297 tests passed.
- Web: 133 files, 1,564 tests passed with `--maxWorkers=2`. The first run
  alongside the other full suites hit an Apps startup timeout and a related
  auth assertion failure; the complete lower-concurrency rerun passed.
- Internationalization, whitespace checks and the new validator's strict
  TypeScript check passed. Adapter lint has no errors; hostile URL fixtures
  retain the intentional `no-script-url` warnings.
- Real `build:client-summary` passed with both mock flags disabled. The local
  verification output is `/tmp/octo-web-review-1654-client-summary`, explicitly
  marked `sourceDirty: true`; it is not a release artifact or a Client pin.
  CI requires a clean, non-mock manifest.
- Browser fixture uses the source conversion handler, real Semi Toast, styles
  and locale files. English/Chinese navigation/import failures at 1280px and
  375px passed DOM overflow, full-URL selection and retry-copy checks.
  Browser screenshot capture failed, so pixel-level visual QA is not claimed.
- Client main-process E2E, the private Web Docs implementation and deployment
  `docs_on` still require downstream verification. Before release, build from
  the final clean PR head and update the Client pin to that exact source.
