# Webhook Fleet issue preview

This feature owns the resizable chat-side shell for Fleet task links clicked in
incoming Webhook messages.

- Identity comes only from the server-authenticated `message.fromUID` prefix
  `iwh_`; payload display metadata is not an identity signal.
- Only the Fleet issue link actually clicked by the user is handled. Plain body
  text and unrelated links preserve their existing behavior.
- The base package parses the deep link and owns the generic panel shell. Task
  data and the canonical Loop issue detail UI are injected by `@octo/loop`
  through the `chatWebhookIssuePreview` endpoint, preserving dependency
  direction.
- Width is stored independently under
  `wk-webhook-issue-preview-panel-width`. Narrow chat areas use an overlay.

Link arbitration lives in `bridge/message/webhookPreview.ts`; the generic
drag/close shell lives in `ui/ResizableRightPanel`.

## Behavior list

- Entry: click a `/fleet/{workspace}/issues/{identifier}` link inside an
  incoming Webhook message.
- Primary path: the clicked task opens in a resizable, closable right panel;
  unrelated links keep their existing new-tab behavior.
- States: the panel owns loading, the same read-only detail layout used by the
  full Loop view, retry, and an open-full-page fallback.
- Context: requests use the workspace slug from the clicked link and do not
  change the workspace selected in the full Loop page.
- Navigation: no new route or menu is added.

## File map

- `bridge/message/webhookPreview.ts`: Webhook identity gate and Fleet link
  parsing.
- `ui/ResizableRightPanel/`: shared drag, close, overlay, and persisted-width
  shell.
- `features/webhookMessagePreview/`: chat-side panel host.
- `packages/dmloop/src/api/issuePreviewApi.ts`: read-only task snapshot API.
- `packages/dmloop/src/bridge/useIssuePreview.ts`: request state and retry.
- `packages/dmloop/src/panel/IssueDetailPage.tsx`: canonical full/detail-panel
  renderer; snapshot mode disables mutations without changing Loop page mode.
- `packages/dmloop/src/features/webhookIssuePreview/`: scoped snapshot adapter.

## PR scope

This change adds one Webhook Fleet-task preview entry and the shared shell it
needs. It reuses the canonical Loop detail renderer in read-only snapshot mode;
it does not embed the Fleet page, add editing actions, add a second task route,
or change non-Fleet link behavior. Shared impact is limited to message body
click forwarding, chat-side panel arbitration, endpoint injection, and the
backward-compatible snapshot props on the existing detail renderer.

## Verification plan

- Run focused tests for link arbitration, panel sizing, message hit areas, and
  workspace-scoped task loading.
- Build the web app and Storybook, then run i18n and CSS checks.
- Inspect the full detail and 760px / 480px panel layouts in light and dark
  themes, including loading and error states.
- Manually verify one Webhook message with multiple links, panel resizing and
  closing, a non-Fleet link, and switching conversations while the panel is
  open.
