# Unified summary mirror (web)

Two mirrors, two jobs. Both serve real product code; they differ in what stands
behind it.

| | `:28370` full-Octo mirror | `:28372` hermetic fixture host |
|---|---|---|
| bundle | the whole `apps/web` production build | a summary-only fixture bundle |
| shell | the real app — login, nav rail, chat page, theme | a fixture page around the summary hosts |
| backend | our summary API against the real dev stack (`octo-server` auth, real IM data, real LLM) | the isolated synthetic fixture (stub auth/model/notify) |
| identity | your own account, real login | hard-coded synthetic `owner` |
| purpose | walking the whole flow by hand | the automated acceptance (`browser.mjs`) |

Use the full-Octo mirror to answer "does this look and behave like Octo"; use
the hermetic one to answer "is the unified design still correct" without
touching anyone's data.

## `:28370` — the full Octo app

`Dockerfile.octo` packages the production `apps/web` build on the repo's own
production `nginx.conf.template`, so every route rule (`/api/`,
`/summary/api/v1/`) is the deployed one and the browser loads the same bundle a
release does — app shell, nav rail, chat page, summary module. Nothing is
re-implemented and nothing is mocked in the browser.

```bash
# build the whole app, then the image (repo root)
pnpm turbo run build --filter=@octo/web
docker build -f tests/unified-summary-mirror/Dockerfile.octo \
  -t octo-web:unified-continue-optimize-20260910 .
```

The containers (this web image plus our summary API/worker wired into the dev
stack) come up from the **backend** worktree's
`tests/unified-summary-mirror/compose.octo.yml`; that file documents the exact
command and which parts are real. Then open `http://127.0.0.1:28370/` and log in
with your own account — the summary entry is the nav rail's 总结, and the chat
page's ✨ opens the side panel.

## `:28372` — the hermetic fixture host

Serves the **real** summary frontend over the paired backend fixture, so the
unified design can be accepted in a browser instead of only in unit tests.

"Real" means the fixture runs the production bootstrap
`initializeSummaryWebRuntime()` — the same call `module.tsx` makes in the Web app,
installing the i18n namespace, the legacy routes, the attention runtime, candidate
search and the chat extension — and then mounts the summary UI only through what
that bootstrap registered. Nothing about the summary feature is re-implemented
here; the fixture only fakes the surrounding chat page. Two mounts, switchable
from the tab bar or `?mount=`:

- `?mount=workspace` (default) — `SummaryWorkspace`, the unified entry that owns
  list / create / detail / schedules.
- `?mount=chat` — the IM chat side panel. The ✨ button comes from
  `WKApp.endpoints.channelHeaderRightItems`, the `wk:toggle-summary-panel` bus
  event opens the panel with the view that button chose, and the panel itself is
  `WKApp.endpoints.chatSummaryPanel` rendered inside
  `.wk-chat-content-right > .wk-summary-panel`, exactly as the chat page does it.

The backend half lives in the API repo at `tests/unified-summary-mirror/`. Bring
that up and run its `smoke.mjs` first: this fixture reads the two summaries that
smoke produces (task 1 = from-scratch agent save, task 2 = its continue-optimize
derivative, configured and regenerated to V3).

## Why a separate fixture from `tests/formal-content-mirror`

That one mounts `FormalContentEntry` alone, which is enough to exercise the
content-protocol panels but cannot show the thing under test here: how the
unified list and detail split 继续优化 (a *new* summary via the agent route) from
重新生成 / 配置与定时更新 (new versions of the *same* summary).

## Run

```bash
# 1. build the fixture bundle + image (repo root)
npx vite build --config apps/web/vite.unified-mirror.config.ts
docker build -f tests/unified-summary-mirror/Dockerfile -t octo-summary-unified-mirror-web .

# 2. serve it on the backend fixture's network so /summary/ can proxy through
#    (:28372 — :28370 belongs to the full-Octo mirror above)
docker run -d --name octo-summary-unified-mirror-web \
  --network octo-summary-versioning-test -p 127.0.0.1:28372:80 \
  octo-summary-unified-mirror-web

# 3. walk the flow
node tests/unified-summary-mirror/browser.mjs
```

Open `http://127.0.0.1:28372/` for the workspace list, `?task=2` to deep-link a
detail, `?mount=chat` for the chat side panel, `?lang=en-US` / `?theme=dark` to
check the other locale and palette.

Identity is synthetic and hard-coded in `main.tsx` (`owner` / `fixture-owner`
in space `unified-fixture`), matched to the backend fixture's auth stub. No real
token is ever stored or requested.

## What `browser.mjs` accepts

1. One unified list holds both the from-scratch and the continue-optimize summary.
2. 继续优化 is its own entry and leaves the detail for the agent create route —
   it never rewrites the current summary in place.
3. 重新生成 / 配置与定时更新 are same-summary entries, and 重新生成 stays shut on
   an agent summary whose generation config is still incomplete while
   配置与定时更新 (补齐配置) is offered on both.
4. The schedule saved through 配置 shows on the detail, at the version the
   same-summary regenerations produced (V3).
5. The chat side panel is the same product, not a reduced copy: the real
   channel-header button opens the real panel, its card menu offers the same
   split as the workspace's, and 继续优化 there also leaves the detail for the
   agent flow with the source summary attached as 引用总结.

It also fails on any uncaught page error, any `console.error`, and any
`/summary/api/` response ≥ 400.

Two things the fixture data explains, not defects:

- The derived summary's card and detail heading read
  `汇总 Alpha 项目本周进展、风险与决议`, not the agent's original
  `Alpha 项目周报(补充风险与下一步)`. 补齐配置 is what gives a summary a
  topic to regenerate on, so a configured summary renders that requirement as
  its topic.
- V2 and V3 are both real reports but not identical. The backend fixture forces
  the schedule's due slot two days into the past so the worker claims it, which
  makes the scheduled window `[now-9d, now-2d]` against the manual
  `[now-7d, now]` — different messages in scope, so a different set of bullets.
  That difference is the point: it is what makes 版本记录 worth opening.

Screenshots land in `/tmp/unified-mirror-*.png`.
