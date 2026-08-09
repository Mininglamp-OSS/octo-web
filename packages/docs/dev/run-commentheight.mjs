// Regression check for the comment-composer height bug (side effect of #909).
//
// SCOPE OF THIS CHECK — read before trusting it. The bug is purely a CSS SCOPE collision:
// `.octo-prose .ProseMirror { min-height: 320px }` (which reserves clickable empty space for the
// MAIN document body) also matched the small tiptap instance that MentionComposer renders for the
// comment composer, because that composer is nested inside the document editor. So what has to be
// verified is which rule wins on which element — that needs a real browser + the real stylesheet,
// but NOT the whole app.
//
// It deliberately does not boot the dev harness: `dev/main.dev.tsx` is currently broken on main
// (dev/octoBase.dev.ts does not export Channel/Conversation/ChannelTypePerson, so the module graph
// fails to load). Fixing that shim is unrelated to this CSS fix.
//
// The DOM below mirrors the real tree, each layer confirmed in source:
//   .octo-prose            <- editor/EditorShell.tsx:807  <EditorContent className="octo-prose">
//     .ProseMirror         <- tiptap's own content element (main document body)
//     .octo-comment-bubble <- comments/CommentBubble.tsx:76, rendered by tiptap BubbleMenu, so it
//                             lives INSIDE the .octo-prose subtree — the crux of the bug
//       .octo-comment-input.octo-mention-composer  <- mentions/MentionComposer.tsx:94
//         .ProseMirror     <- the composer's own tiptap content element
//
// Because it asserts computed style rather than component behaviour, it stays valid only while that
// markup holds; the class names above are the contract. If MentionComposer stops rendering a
// .ProseMirror, this check reports it instead of passing quietly.
//
// COLLATERAL SCOPE. `.octo-comment-input` is shared by four call sites, and the reset is a
// DESCENDANT selector, so what matters is not "is it a textarea" but "does a .ProseMirror exist
// under it, and is it inside .octo-prose". board/BoardCommentPanel.tsx:358 does render a
// MentionComposer (so it DOES match the reset), but BoardShell never applies .octo-prose, so the
// 320px rule never reached it and the reset is a no-op there. That is asserted below against the
// real board tree rather than argued from source, because "it has no tiptap" would be wrong.
//
// Usage: node dev/run-commentheight.mjs
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const CSS = resolve(dirname(fileURLToPath(import.meta.url)), '../src/editor/styles.css')
const LABEL = process.env.LABEL || 'run'

const MARKUP = `
<div class="octo-prose">
  <div class="ProseMirror" id="main-body"><p>document body</p></div>
  <div class="octo-comment-bubble">
    <div class="octo-comment-compose">
      <div class="octo-comment-input octo-mention-composer" id="composer">
        <div class="ProseMirror" id="composer-body"><p>添加评论…</p></div>
      </div>
    </div>
  </div>
</div>
<!-- Board comment panel: board/BoardCommentPanel.tsx:341,354,358. It also nests a MentionComposer
     (so the reset DOES match it), but there is no .octo-prose ancestor, so the 320px rule never
     applied and the reset must not change its size. -->
<section class="octo-comment-panel octo-board-comment-panel">
  <div class="octo-comment-compose">
    <div class="octo-comment-input octo-mention-composer" id="board-composer">
      <div class="ProseMirror" id="board-composer-body"><p>comment</p></div>
    </div>
  </div>
</section>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.setContent(`<!doctype html><html><body>${MARKUP}</body></html>`)
await page.addStyleTag({ path: CSS })

const m = await page.evaluate(() => {
  const px = (id) => getComputedStyle(document.getElementById(id)).minHeight
  const box = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height)
  return {
    mainMin: px('main-body'),
    composerInnerMin: px('composer-body'),
    composerWrapMin: px('composer'),
    composerBox: box('composer'),
    boardWrapMin: px('board-composer'),
    boardInnerMin: px('board-composer-body'),
    boardBox: box('board-composer'),
  }
})

let failed = false
const check = (ok, msg) => {
  console.log(`[${LABEL}] ${ok ? 'OK  ' : 'FAIL'} ${msg}`)
  if (!ok) failed = true
}

console.log(
  `[${LABEL}] main .ProseMirror min-height=${m.mainMin} | ` +
    `composer wrapper min-height=${m.composerWrapMin} inner=${m.composerInnerMin} box=${m.composerBox}px`,
)

// The main document body must KEEP its tall clickable area — a fix that killed this would leave
// short documents with almost no clickable space below the text.
check(m.mainMin === '320px', 'main document body keeps min-height: 320px')
// The regression itself.
check(m.composerInnerMin !== '320px', `composer inner .ProseMirror is not 320px (got ${m.composerInnerMin})`)
// The composer keeps the floor the plain <textarea> had before #909, so it doesn't collapse.
check(m.composerWrapMin === '56px', 'composer wrapper keeps its 56px floor')
check(m.composerBox <= 120, `composer renders small (${m.composerBox}px <= 120px)`)
// Collateral: the board composer also matches the reset (it nests a MentionComposer too), but it
// lives outside .octo-prose, so it was never 320px and must stay exactly the size of the plain
// textarea siblings it sits next to. Guards against "fixing" docs by resizing the board.
check(m.boardWrapMin === '56px', 'board composer keeps the shared 56px floor')
check(m.boardBox === 70, `board composer size unchanged (${m.boardBox}px, same as a plain textarea)`)

await browser.close()
console.log(`[${LABEL}] ${failed ? 'FAILED' : 'PASSED'}`)
process.exit(failed ? 1 : 0)
