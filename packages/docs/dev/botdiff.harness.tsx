// Real-browser harness for the BOT-EDIT DIFF entry point + the @-mention candidate panel.
//
// WHY a real browser: the product owner's complaint was "I open the UI and can't see the diff".
// The unit suite renders these components in jsdom, where CSS does not exist and nothing is ever
// laid out — so a control that is present in the DOM but unstyled/invisible/unreachable passes
// every test and still fails the user. This harness mounts the PRODUCTION components against a
// mocked backend and lets the Playwright driver (dev/run-botdiff.mjs) click through the real entry
// point and screenshot what a user actually sees.
//
// Two panels are mounted side by side:
//   • LEFT  — <VersionPanel>, the exact adapter EditorShell renders (docId/role/editor/names), fed
//     a version list containing a bot-edit safety snapshot row ('Auto-safety before bot edit',
//     kind=3). This exercises the badge, the "view what the bot changed" button, the diff modal and
//     the admin-only undo, with a REAL live editor supplying the "current" side of the diff.
//   • RIGHT — <MentionComposer>, so typing `@` opens the real suggestion popup and the candidate
//     panel can be screenshotted.
//
// The mocked wire shapes are copied from the verified backend contract (octo-docs-backend
// src/api/routes/versions.ts toItem): `kind` is NUMERIC on the wire (1=auto, 2=named,
// 3=restore-marker) and the safety snapshot's `name` is exposed as `label`. Dev-only file; never
// part of the production build.

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'
import { i18n, setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { VersionPanel } from '../src/versions/VersionPanel.tsx'
import { MentionComposer } from '../src/mentions/MentionComposer.tsx'
import zhCN from '../src/i18n/zh-CN.json'
import enUS from '../src/i18n/en-US.json'
// The host's design tokens. styles.css consumes `--wk-*` (backgrounds, borders, radii, the AI
// accent) and in production the host loads this sheet; without it every `var(--wk-…)` resolves to
// nothing and the harness renders transparent modals / colourless chrome — i.e. a screenshot that
// lies about production. Import the real theme entry so the shot is faithful.
import '../../dmworkbase/src/theme/index.css'
import '../src/editor/styles.css'

const DOC_ID = 'd_botdiff_harness'
const SPACE_ID = 's_harness'
const SELF = 'u_self'
const BOT_UID = '27eurkdhmot887a25f6_bot'
const FRIEND_BOT_UID = '27e8pp4eoes28a28594_bot'
const OFFLINE_BOT_UID = '27offline0002_bot'

// The pre-edit snapshot the bot left behind: this is the BEFORE side of the diff.
const SAFETY_SEQ = 41

/** BEFORE: what the document looked like before the bot touched it. */
const BASELINE_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '季度产品计划' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '本季度的目标是把文档协作的基础能力补齐。' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '这一段没有被改动，用来验证 unchanged 行。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '风险：排期依赖外部团队，需要提前对齐。' }] },
  ],
}

/** AFTER: the live body, i.e. what the bot rewrote it into. Drives the +/- diff rows. */
const CURRENT_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '季度产品计划（Bot 已改写）' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '本季度的目标是补齐文档协作的基础能力，并把可执行评论作为重点投入。' },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '这一段没有被改动，用来验证 unchanged 行。' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '风险：排期依赖外部团队；已增加一周缓冲并指定了对接人。' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '新增：本次改写由 Bot 执行，可在版本记录中撤销。' }] },
  ],
}

// ── Mock backend ──────────────────────────────────────────────────────────────
//
// Every path the two panels touch. Anything unrecognised resolves `{}` so a stray call cannot
// crash the harness (it would only surface as an empty list).
const wk = createMockWKApp({ uid: SELF, token: 'dev-token' })

/** Version rows, newest first. `kind` numeric exactly as the backend serialises it. */
const versionRows = [
  {
    docVersionSeq: SAFETY_SEQ,
    kind: 3, // KIND_RESTORE_MARKER — the bot-edit safety snapshot
    label: 'Auto-safety before bot edit',
    createdBy: BOT_UID,
    createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    sizeBytes: 2048,
    schemaVersion: 19,
    restoredFrom: null,
  },
  {
    docVersionSeq: 38,
    kind: 2, // a human named snapshot, for visual contrast against the bot row
    label: '评审前定稿',
    createdBy: SELF,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    sizeBytes: 1900,
    schemaVersion: 19,
    restoredFrom: null,
  },
  {
    docVersionSeq: 33,
    kind: 3,
    label: 'Auto-safety before restore', // a HUMAN restore marker: must NOT be badged as a bot edit
    createdBy: SELF,
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    sizeBytes: 1750,
    schemaVersion: 19,
    restoredFrom: 30,
  },
]

wk.apiClient.responder = (method, rawUrl) => {
  const url = rawUrl.split('?')[0]
  const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''

  // GET /docs/:docId/versions — mirrors the backend's kind filter: 'auto' returns kind=1 ONLY, so
  // a safety snapshot is invisible there; 'all' and 'manual' both include kind=3.
  if (method === 'get' && url === `/docs/${DOC_ID}/versions`) {
    const kind = new URLSearchParams(query).get('kind') ?? 'manual'
    const items =
      kind === 'auto'
        ? versionRows.filter((v) => v.kind === 1)
        : kind === 'manual'
          ? versionRows.filter((v) => v.kind !== 1)
          : versionRows
    return {
      data: {
        items,
        nextCursor: null,
        counts: { auto: 0, manual: 1, restore: 2, total: 3 },
      },
      status: 200,
    }
  }

  // GET /docs/:docId/versions/:seq/state — the decoded PM-JSON baseline (方案 B JSON contract).
  const stateMatch = url.match(new RegExp(`^/docs/${DOC_ID}/versions/(\\d+)/state$`))
  if (method === 'get' && stateMatch) {
    return {
      data: { doc: BASELINE_DOC, schemaVersion: 19, docVersionSeq: Number(stateMatch[1]) },
      status: 200,
    }
  }

  // POST restore — the undo path. Forward/non-destructive: returns the NEW seq it created.
  if (method === 'post' && /\/restore$/.test(url)) {
    return { data: { newDocVersionSeq: 44, restoredFrom: SAFETY_SEQ }, status: 200 }
  }

  // Doc members — the source of "does this Bot have writer+ on THIS doc?". Mirrors the real
  // production data the owner reported: only ONE of the two bots is actually a doc member.
  if (method === 'get' && url === `/docs/${DOC_ID}/members`) {
    return {
      data: {
        items: [
          { uid: SELF, role: 'admin', source: 'owner', grantedBy: SELF },
          { uid: 'u_zhang', role: 'writer', source: 'direct', grantedBy: SELF },
          { uid: 'u_chen', role: 'commenter', source: 'direct', grantedBy: SELF },
          // writer ⇒ eligible to be @-mentioned
          { uid: BOT_UID, role: 'writer', source: 'direct', grantedBy: SELF },
          // Also a doc writer, but the host reports it OFFLINE — so it must be RENDERED and
          // DISABLED (visible, unpickable), not filtered out. That distinction is the whole point.
          { uid: OFFLINE_BOT_UID, role: 'writer', source: 'direct', grantedBy: SELF },
          // NOTE: FRIEND_BOT_UID ('test') is deliberately ABSENT — it must not be offerable.
        ],
      },
      status: 200,
    }
  }

  // Friend-dimension bots (/robot/my_bots) — includes the non-member 'test' bot on purpose.
  if (method === 'get' && url === '/robot/my_bots') {
    return {
      data: [
        {
          uid: BOT_UID,
          name: 'Lobster',
          description: '通用文档修改',
          creator_uid: SELF,
          status: 'online',
        },
        {
          uid: FRIEND_BOT_UID,
          name: 'test',
          description: '自己创建但没有加入本文档',
          creator_uid: SELF,
          status: 'online',
        },
        {
          uid: '27legalagent0001_bot',
          name: 'LegalAgent',
          description: '合规审阅与风险改写',
          creator_uid: 'u_li',
          status: 'online',
        },
        {
          uid: OFFLINE_BOT_UID,
          name: 'OfflineAgent',
          description: '当前不在线的机器人',
          creator_uid: SELF,
          status: 'offline',
        },
      ],
      status: 200,
    }
  }

  // Owner-scoped bots (/robot/owned_bots) — bots the caller CREATED, per the server's own filter.
  if (method === 'get' && url === '/robot/owned_bots') {
    return {
      data: [
        { uid: BOT_UID, name: 'Lobster', description: '通用文档修改' },
        { uid: FRIEND_BOT_UID, name: 'test', description: '自己创建但没有加入本文档' },
        { uid: OFFLINE_BOT_UID, name: 'OfflineAgent', description: '当前不在线的机器人' },
      ],
      status: 200,
    }
  }

  // Doc list — the @doc mention source.
  if (method === 'get' && url === '/docs') {
    return {
      data: {
        items: [
          { docId: 'd_spec', title: '可执行评论技术方案', docType: 'doc' },
          { docId: 'd_plan', title: '季度产品计划', docType: 'doc' },
        ],
        nextCursor: null,
      },
      status: 200,
    }
  }

  return { data: {}, status: 200 }
}

// Human space members (resolved through the seam, not the REST client).
wk.spaceMembers.push(
  { uid: SELF, name: '王敏' },
  { uid: 'u_zhang', name: '张三' },
  { uid: 'u_chen', name: '陈璐' },
  { uid: BOT_UID, name: 'Lobster', isBot: true },
)
wk.shared.currentSpaceId = SPACE_ID

setWKApp(wk)
i18n.registerNamespace('docs', { 'zh-CN': zhCN, 'en-US': enUS })

/** uid → display name, so the version rows show names instead of raw uids. */
const NAMES = new Map<string, string>([
  [SELF, '王敏'],
  ['u_zhang', '张三'],
  [BOT_UID, 'Lobster'],
])

function Harness() {
  // A REAL live editor holding the AFTER body — VersionPanel reads its JSON as the "current" side
  // of the diff (getCurrent), exactly as EditorShell does.
  const editor = useEditor({
    extensions: [StarterKit.configure({ undoRedo: false })],
    content: CURRENT_DOC,
    editable: false,
  })
  const [body, setBody] = useState('')

  // Expose the seams the Playwright driver needs.
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__botDiffHarness = {
      ready: () => editor != null,
      body: () => body,
      calls: () => wk.apiClient.calls.map((c) => `${c.method} ${c.url}`),
    }
  }, [editor, body])

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, alignItems: 'flex-start' }}>
      <div data-panel="versions" style={{ width: 520, flex: '0 0 auto' }}>
        <h3 style={{ margin: '0 0 8px' }}>版本记录（含 Bot 改动）</h3>
        <VersionPanel
          docId={DOC_ID}
          role="admin"
          editor={(editor as Editor | null) ?? undefined}
          names={NAMES}
        />
      </div>

      {/* The suggestion popup mounts on document.body and is positioned under the caret, so each
          composer needs enough clear space BELOW it for the popup to occupy — otherwise the open
          popup lands on top of the next block's heading and the screenshot is unreadable. Hence the
          fixed reserved height per composer rather than natural flow. */}
      <div data-panel="mention" style={{ width: 380, flex: '0 0 auto' }}>
        <div data-panel="mention-admin" style={{ minHeight: 380 }}>
          <h3 style={{ margin: '0 0 8px' }}>@ 候选面板（admin，可 @Bot）</h3>
          <MentionComposer
            docId={DOC_ID}
            spaceId={SPACE_ID}
            role="admin"
            placeholder="输入 @ 试试"
            onChange={setBody}
          />
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#666', margin: '4px 0 0' }}>
            {body}
          </pre>
        </div>

        <div data-panel="mention-commenter" style={{ minHeight: 180 }}>
          <h3 style={{ margin: '0 0 8px' }}>@ 候选面板（commenter，无权 @Bot）</h3>
          <MentionComposer
            docId={DOC_ID}
            spaceId={SPACE_ID}
            role="commenter"
            placeholder="输入 @ 试试（commenter）"
            onChange={() => {}}
          />
        </div>
      </div>

      {/* The live body, so the screenshot shows what "current" actually is. */}
      <div data-panel="current" style={{ width: 420, flex: '0 0 auto' }}>
        <h3 style={{ margin: '0 0 8px' }}>当前正文（Bot 改写后）</h3>
        <EditorContent editor={editor} className="octo-prose" />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
