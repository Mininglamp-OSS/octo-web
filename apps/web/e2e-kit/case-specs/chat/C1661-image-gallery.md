# C1661 — Conversation image gallery

Real chat page with mocked IM and HTTP boundaries. No messages are sent to a live server.

1. Seed text, separate image messages, a multi-image message, a merge-forward message with a nested forward, and a burn-after-reading image.
2. Open the middle image; verify the visible image, loaded-image counter, and its fully interpolated accessible name. Recheck the accessible name after navigation.
3. Navigate across messages and within the multi-image message using buttons and arrow keys.
4. Download after switching and verify the user-visible filename; rotate and continue browsing.
5. Verify finite boundaries, close/reopen, and exclusion of the forwarded/private images from the main gallery.
6. Open merge-forward contents and verify their separate gallery, then enter the nested forward and verify its single-image scope.
7. Include numeric-string dimensions in a multi-image history payload; verify the thumbnail has a visible size and that the gallery image actually loads.
8. Select two PNG files and send them through the real composer and media upload task. Delay upload/ACK responses and verify local/remote thumbnails remain visible. Confirm each image, then navigate between them in the gallery.
9. Return an upload failure; verify the local thumbnail and retry control remain visible. Retry, confirm delivery, and open its gallery entry.
10. Reject the server ACK after a successful upload; verify the remote thumbnail and resend control. Resend, confirm, and open its gallery entry.

Upload tests retain the actual file reader, size measurement, SDK send queue and media upload task. MSW stores uploaded bytes and serves them back to the real image elements. ACK notifications are simulated at the SDK boundary. Browser assertions observe the UI; single-image serialization compatibility is covered by the decoder/bridge unit tests.

Register the shared clear-unread handler before opening the conversation so ACK/retry flows do not leak unhandled requests to the preview proxy. CI verification uses `playwright.ci.config.ts` and checks the full log for zero `http proxy error:` lines, in addition to test results.

Run `pnpm --dir apps/web exec playwright test --config=e2e-kit/playwright.config.ts C1661-image-gallery --repeat-each=3 --workers=1`.
