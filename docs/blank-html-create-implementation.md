# Direct blank HTML creation

## Behavior list
- The existing **New HTML** entry opens one modal with name and requirements fields; it no longer asks for a Bot or opens a private conversation.
- Submit publishes one minimal valid HTML v1 in the current Space. While publishing, submit is disabled.
- A complete `registered: true`, `status: published`, non-empty `doc_id` response closes the modal, refreshes the list, and opens the HTML by returned doc id and slug.
- `registration_failed` says that publishing succeeded but registration failed and cannot submit again. Other publish errors keep the editable form.
- After a complete `registered: true`, `status: published`, non-empty `doc_id` response, the opened HTML view offers a copyable modification prompt containing the real doc id and slug; it does not depend on Bot chat and is isolated by account, Space, and document.

## File map
- `packages/docs/src/html-create/HtmlCreateService.ts`: octo-doc publish boundary, response parsing, minimal HTML/title escaping, secure slug, and modification prompt helpers.
- `packages/docs/src/html-create/*.test.ts`: helper, Service, and modal behavior tests.
- `packages/docs/src/html-create/CreateHtmlModal.tsx`: existing modal adapted to direct publishing states.
- `packages/docs/src/pages/DocsHome.tsx` and test: remove this entry's conversation wiring; refresh and open the returned HTML.
- `packages/docs/src/i18n/{zh-CN,en-US}.json`: direct-create labels and errors.

## PR scope
- Does: replace the sole New HTML flow with direct blank-v1 publishing and focused tests.
- Does not: remove Bot conversation capabilities used elsewhere, redesign the Docs list, or change octo-doc/backend contracts.
- Impact: Docs HTML-create module and its existing DocsHome entry only.

## Verification plan
- RED/GREEN: `pnpm --dir packages/docs exec vitest run src/html-create/HtmlCreateService.test.ts src/html-create/CreateHtmlModal.test.tsx src/pages/DocsHome.test.tsx`
- Package: `pnpm --dir packages/docs test` and `pnpm --dir packages/docs typecheck`.
- i18n/style: `pnpm i18n:check` and `git diff --check`.
- Manual: in both zh-CN/en-US, create once, verify loading lock, successful list refresh/open, ordinary failure form retention, and registration-failed terminal warning.
