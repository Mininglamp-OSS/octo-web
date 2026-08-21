# Fleet issue preview

This feature owns the resizable chat-side shell for Fleet task links
(`/fleet/{workspace}/issues/{identifier}`) clicked in messages — webhook
messages AND plain user messages.

- Link arbitration lives in `bridge/message/webhookPreview.ts`; the generic
  drag/close shell lives in `ui/ResizableRightPanel`.
- The base package parses the deep link and owns the generic panel shell.
  Task data and the canonical Loop issue detail UI are injected by an
  enterprise Loop module through the `chatWebhookIssuePreview` endpoint,
  preserving dependency direction.
- Width is stored independently under
  `wk-webhook-issue-preview-panel-width`. Narrow chat areas use an overlay.

## Threat model (updated for the all-message source)

The click handler is **source-agnostic**: any message author (webhook bot OR
plain user) can put a fleet-shaped link in a message body. The security
boundary is therefore NOT the message identity (there is no `iwh_` gate
anymore) but the **link target origin**:

- **Statically trusted origin** (same origin / static set `im.deepminer.com.cn` /
  current API origin, keyed on `URL.host` incl. non-default port):
  the preview opens immediately, fully synchronously.
- **Unknown origin on desktop**: the default action is cancelled
  synchronously, the main process shows a native fail-closed dialog
  (`fleet:ask-trust-host`), and the answer may be persisted to
  `userData/fleet-trusted-hosts.json` ("never ask again"). On rejection the
  link is explicitly re-opened in the system browser.
- **Unknown origin on web**: no prompt bridge exists, so the link is left to
  the browser default (new tab) untouched — never preventDefault-ed.

Implication: anyone who can post into a channel can trigger a trust prompt on
desktop clients (per host, de-duplicated while in flight, fail-closed on
Esc/close). This is the same trust boundary a browser uses for an unknown
site; the persisted allowlist is per-client and revocable by deleting
`fleet-trusted-hosts.json` (a settings UI is a tracked follow-up).

**OSS builds** (no registered `chatWebhookIssuePreview` renderer) never
intercept fleet links at all: `isFleetPreviewSupported()` gates the handler,
so fleet links keep their default behaviour (system browser / new tab)
instead of opening a dead "unavailable" panel.

## Behavior list

- Entry: click a `/fleet/{workspace}/issues/{identifier}` link inside a
  message body (left or middle click; right-click passes through to the
  context menu).
- Primary path: the clicked task opens in a resizable, closable right panel.
  Non-fleet links keep their existing behaviour.
- States: the panel owns loading, the same read-only detail layout used by
  the full Loop view, retry, and an open-full-page fallback.
- Context: requests use the workspace slug from the clicked link and do not
  change the workspace selected in the full Loop page.
- Navigation: no new route or menu is added.
- Desktop external links (any message source) are routed to the system
  browser by `setWindowOpenHandler` (http(s) only; other protocols denied).
  The two renderer features that used the web-era `window.open("about:blank")`
  blocked/succeeded dance — realname verification and global-search doc
  open — go through the `IPC_OPEN_EXTERNAL_URL` bridge instead.

## File map

- `bridge/message/webhookPreview.ts`: fleet link parsing, origin trust gate,
  click arbitration (source-agnostic), preview-support gate.
- `ui/ResizableRightPanel/`: shared drag, close, overlay, and persisted-width
  shell.
- `features/webhookMessagePreview/`: chat-side panel host.
- `apps/web/src-election/main/externalLink.ts`: http(s)-only external link
  decision for the shell window router and IPC bridge.
- Enterprise Loop module: read-only task snapshot API, request state and
  retry, canonical detail renderer, and scoped snapshot adapter.

## Verification plan

- Run focused tests for link arbitration, origin trust (incl. port-identity),
  panel sizing, message hit areas, and workspace-scoped task loading.
- Build the web app and Storybook, then run i18n and CSS checks.
- Inspect the full detail and 760px / 480px panel layouts in light and dark
  themes, including loading and error states.
- Manually verify one webhook message with multiple links, one plain user
  message with a fleet link, panel resizing and closing, a non-Fleet link,
  and switching conversations while the panel is open.
