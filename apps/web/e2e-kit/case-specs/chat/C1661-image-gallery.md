# C1661 — Conversation image gallery

Real chat page with mocked IM and HTTP history. No real messages are sent.

1. Seed text, separate image messages, a multi-image message, a merge-forward message with a nested forward, and a burn-after-reading image.
2. Open the middle image; verify the visible image and loaded-image counter.
3. Navigate across messages and within the multi-image message using buttons and arrow keys.
4. Download after switching and verify the user-visible filename; rotate and continue browsing.
5. Verify finite boundaries, close/reopen, and exclusion of the forwarded/private images from the main gallery.
6. Open merge-forward contents and verify their separate gallery, then enter the nested forward and verify its single-image scope.

Run `pnpm --dir apps/web exec playwright test --config=e2e-kit/playwright.config.ts C1661-image-gallery --repeat-each=3 --workers=1`.
