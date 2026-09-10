# GH1651 — Chat URL punctuation

Related issue: https://github.com/Mininglamp-OSS/octo-web/issues/1651

## Behavior

- Automatically detected HTTP(S)/www URLs leave sentence-final ASCII and Chinese
  punctuation outside the link, while preserving the full message text.
- Matched brackets inside a URL are preserved; unmatched enclosing closing
  brackets remain prose. Internal query punctuation and percent encodings stay intact.
- Explicit Markdown links, reference links and `<URL>` destinations are retained.
  Code is not linkified. When punctuation is intentionally part of the end of a
  URL, an explicit Markdown destination can express that intent.
- The same suffix policy applies to ordinary chat Markdown, rich-text blocks and
  reply previews. Markdown keeps GFM's existing URL recognition and www scheme.

## Baseline and scope

At fork main `8d066a842068efb61a9a20580a0309256a1edd60`, the issue's
literal ASCII-comma example already passes isolated rendering tests. Reproduced
failures are Chinese punctuation entering ordinary-message hrefs and matched
right brackets being removed in rich-text/reply links. The original example is
retained as a regression case; reproducing the exact reported production failure
still requires its raw message and deployed version. No stored messages or
explicit destinations are rewritten by this change.

## Browser scenario

1. Use the local mock IM runtime and open the seeded test group.
2. Enter the original three-line example through the real composer.
3. Add a paragraph with Chinese punctuation and a URL with paired parentheses.
4. Add explicit Markdown and angle-bracket links ending in punctuation.
5. Add an escaped math formula followed by a URL ending in Chinese punctuation,
   and send the message with all four paragraphs.
6. Check final message anchors and visible text, then click an automatic link.
   Fulfill the destination locally and verify the popup URL has no extra suffix.

## Verification

```bash
pnpm --filter @octo/base exec vitest run src/Messages/Text/__tests__ src/Utils/__tests__/linkify.test.ts src/Utils/__tests__/security.test.ts src/ui/message/ReplyBlock/__tests__ src/ui/message/MixedContent/__tests__ --maxWorkers=2
pnpm --filter @octo/web build:e2e
PW_PREVIEW_PORT=51651 pnpm --filter @octo/web exec playwright test --config=e2e-kit/playwright.ci.config.ts --grep @GH1651 --repeat-each=3 --workers=1
```
