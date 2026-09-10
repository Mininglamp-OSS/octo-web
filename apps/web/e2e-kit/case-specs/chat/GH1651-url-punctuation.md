# GH1651 — Chat URL punctuation

Related issue: https://github.com/Mininglamp-OSS/octo-web/issues/1651

## Behavior

- Automatically detected HTTP(S)/www URLs leave sentence-final ASCII and Chinese
  punctuation outside the link, while preserving the full message text.
- Han characters and Chinese sentence punctuation also end bare URLs when prose
  follows without whitespace: `https://github.com/Ranwanglc/octo-web的main拉去分支`
  links only `https://github.com/Ranwanglc/octo-web`. Later URLs in the same sentence
  are still recognized. This is a chat heuristic: Chinese URL contents, including
  international domain names, require an explicit Markdown/angle-bracket link or
  an encoded URL (punycode for domain names) to express their full destination.
- Matched brackets inside a URL are preserved; unmatched enclosing closing
  brackets remain prose. Internal query punctuation and percent encodings stay intact.
- Explicit Markdown links, reference links and `<URL>` destinations are retained.
  Code is not linkified. When punctuation is intentionally part of the end of a
  URL, an explicit Markdown destination can express that intent.
- The same boundary policy applies to ordinary chat Markdown, rich-text blocks
  and reply previews. Markdown retains GFM's `http` scheme for www links.

## Baseline and scope

At fork main `8d066a842068efb61a9a20580a0309256a1edd60`, the issue's
literal ASCII-comma example already passes isolated rendering tests. Reproduced
failures are Chinese punctuation entering ordinary-message hrefs and matched
right brackets being removed in rich-text/reply links. Follow-up testing at
`6fb28df5` also reproduced the user's screenshot: Chinese prose directly after
`https://github.com/Ranwanglc/octo-web` was included in the destination. The
original example is retained as a regression case; reproducing the exact reported
production failure still requires its raw message and deployed version. No stored
messages or explicit destinations are rewritten by this change.

## Browser scenario

1. Use the local mock IM runtime and open the seeded test group.
2. Enter the original three-line example through the real composer.
3. Add a paragraph with Chinese punctuation and a URL with paired parentheses.
4. Add explicit Markdown and angle-bracket links ending in punctuation.
5. Add the user's screenshot sentence and two URLs separated by Chinese prose
   without whitespace, plus an escaped math formula followed by a URL ending in
   Chinese punctuation. Send all paragraphs together.
6. Check final message anchors and the complete visible text, then click the
   screenshot's GitHub link. Fulfill the destination locally, verify the popup URL
   is exactly `https://github.com/Ranwanglc/octo-web`, and save a screenshot.

## Verification

```bash
pnpm --filter @octo/base exec vitest run src/Messages/Text/__tests__ src/Utils/__tests__/linkify.test.ts src/Utils/__tests__/security.test.ts src/ui/message/ReplyBlock/__tests__ src/ui/message/MixedContent/__tests__ --maxWorkers=2
pnpm --filter @octo/web build:e2e
PW_PREVIEW_PORT=51651 pnpm --filter @octo/web exec playwright test --config=e2e-kit/playwright.ci.config.ts --grep @GH1651 --repeat-each=3 --workers=1
pnpm --filter @octo/web build
```

Follow-up validation on 2026-09-10: 393 unit/component tests passed; the browser
scenario passed three consecutive runs; mock and production builds passed.
The full Web TypeScript check has existing errors. Comparing compiler diagnostics
against `6fb28df5` with the same configuration and dependencies found no new errors
and no diagnostics in the changed files.
