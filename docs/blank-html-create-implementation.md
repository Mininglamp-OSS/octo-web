# HTML creation workflows

## Behavior list
- The existing **New HTML** entry opens one modal with two selectable workflows: **create first, then let a Bot modify it**, or **let a Bot create it directly**.
- Direct creation publishes a minimal blank HTML v1 in the current Space. While publishing, closing and workflow switching are disabled.
- Direct creation keeps the modal open after a complete `registered: true`, `status: published`, non-empty `doc_id` response. The user can copy a comment prompt containing the real doc id and slug and open the document, or open it directly.
- The direct-create prompt tells the Bot to modify the current HTML from a document comment, reuse the same `doc_id` and slug, and never create another HTML. It is not shown persistently in `HtmlDocView`.
- `registration_failed` is terminal. Network failures or malformed successful responses are also terminal because the client cannot safely know whether v1 was committed; an explicit HTTP failure remains retryable.
- Bot creation retains owned-Bot selection, attachments, prompt preview, and the embedded private conversation. A `request_id` identifies the task, and remounts cannot auto-send it twice.
- The modal provides overlay, Escape, footer-cancel, and header-close exits; all are locked while direct publication is in flight.

## File map
- `packages/docs/src/html-create/HtmlCreateService.ts`: direct publish boundary, response classification, minimal HTML/title escaping, secure slug, and modification prompt helper.
- `packages/docs/src/html-create/CreateHtmlModal.tsx`: workflow selection, direct creation states, Bot-task preparation, prompt copy, and close controls.
- `packages/docs/src/html-create/createHtmlTask.ts`: authoritative Bot-create task text and directive isolation.
- `packages/docs/src/html-create/DocsBotConversation.tsx`: one-shot Bot conversation handoff.
- `packages/docs/src/pages/DocsHome.tsx`: document opening plus Bot-conversation lifecycle and bounded list refresh.
- `packages/docs/src/html/HtmlDocView.tsx`: read-only HTML view without a persistent creation prompt.
- `packages/docs/src/i18n/{zh-CN,en-US}.json`: workflow labels, guidance, and failure states.

## PR scope
- Does: support both direct blank-v1 creation and the existing Bot-driven creation workflow from one New HTML entry.
- Does: keep trusted user ownership and Space registration on the existing docs-html/docs-backend cross-repo path.
- Does not: change octo-server, channels, mentions, or database schemas.
- Impact: Docs HTML-create UI, its DocsHome integration, and focused tests.

## Verification plan
- Focused: `pnpm --dir packages/docs exec vitest run src/html-create/CreateHtmlModal.test.tsx src/html-create/HtmlCreateService.test.ts src/html-create/DocsBotConversation.test.tsx src/html-create/createHtmlTask.test.ts src/html/HtmlDocView.test.tsx src/html/HtmlDocViewModes.test.tsx src/pages/DocsHome.test.tsx src/pages/DocsHome.pptFlagOff.test.tsx src/pages/DocsHome.pptFlagOn.test.tsx src/i18n/i18n.test.ts`.
- Package: `pnpm --dir packages/docs test` and `pnpm --dir packages/docs typecheck`.
- i18n/style: `pnpm i18n:check` and `git diff --check`.
- Manual: in both zh-CN/en-US, exercise both workflows, direct success/open choices, Bot handoff, all close controls, retryable HTTP failure, and terminal ambiguous/registration failures.
