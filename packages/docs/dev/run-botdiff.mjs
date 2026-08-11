// Playwright driver for the bot-edit diff entry point + the @-mention candidate panel.
// Usage: node dev/run-botdiff.mjs        (expects the standalone dev server, default :4188)
//
// WHAT IT PROVES (and why jsdom can't): the product complaint was "I open the UI and cannot see the
// diff". So this asserts the USER-VISIBLE chain, not DOM presence:
//   1. the bot-edit row is badged, and a HUMAN restore marker in the same list is NOT badged
//   2. the "view what the bot changed" button exists AND is actually clickable/visible
//   3. clicking it opens the diff modal with real +/- rows computed against the live editor body
//   4. the admin-only undo button is present, and its second confirmation appears before any write
//   5. the "auto" filter tab does NOT list the safety snapshot (verified backend filter semantics)
//   6. the @ menu opens and only offers bots that are BOTH caller-reachable and doc writers
// Screenshots land in /tmp/mention-shots/ for eyeball review.

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4188'
const URL = `http://localhost:${PORT}/botdiff.html`
const OUT = process.env.SHOT_DIR || '/tmp/mention-shots'
mkdirSync(OUT, { recursive: true })

const log = (...a) => console.log(...a)
const fail = (m) => {
  console.error('BOTDIFF FAIL:', m)
  process.exitCode = 1
}
const ok = (m) => console.log('  ok:', m)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', (e) => log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') log('[console.error]', m.text())
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-panel="versions"] .octo-version-row', { timeout: 20000 })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/01-version-list.png`, fullPage: true })
log('\n— 1. version list —')

// ── 1. the bot row is badged; the human restore marker is not ────────────────
const rows = page.locator('[data-panel="versions"] .octo-version-row')
const rowCount = await rows.count()
log(`rows rendered: ${rowCount}`)
if (rowCount < 3) fail(`expected 3 version rows, got ${rowCount}`)

const botRows = page.locator('[data-panel="versions"] .octo-version-row.is-bot-edit')
const botRowCount = await botRows.count()
log(`rows flagged is-bot-edit: ${botRowCount}`)
if (botRowCount !== 1) {
  fail(`exactly ONE row should be a bot edit (the other kind=3 row is a human restore), got ${botRowCount}`)
} else {
  ok('bot-edit row badged, human restore marker NOT badged')
}
log('bot row text: ' + (await botRows.first().innerText()).replace(/\n/g, ' | '))

// ── 2. the diff entry button is present AND visible ─────────────────────────
log('\n— 2. diff entry button —')
const diffBtn = page.locator('.octo-version-bot-diff-btn')
if ((await diffBtn.count()) === 0) {
  fail('no .octo-version-bot-diff-btn rendered — the diff entry point does not exist in the UI')
} else {
  const visible = await diffBtn.first().isVisible()
  const box = await diffBtn.first().boundingBox()
  log(`button visible=${visible} box=${JSON.stringify(box)} text="${await diffBtn.first().innerText()}"`)
  if (!visible) fail('diff entry button is in the DOM but NOT visible to the user')
  else if (!box || box.width < 8 || box.height < 8) fail(`diff button has a degenerate box: ${JSON.stringify(box)}`)
  else ok('diff entry button is visible and clickable')
}

// ── 3. clicking it opens the diff modal with real +/- rows ───────────────────
log('\n— 3. diff modal —')
await diffBtn.first().click()
await page.waitForSelector('.docs-bot-diff-modal', { timeout: 10000 }).catch(() => {})
if ((await page.locator('.docs-bot-diff-modal').count()) === 0) {
  fail('clicking the diff button did not open .docs-bot-diff-modal')
} else {
  ok('diff modal opened')
}
// The baseline loads over the mocked REST call, so wait for either diff rows or an error.
await page
  .waitForFunction(
    () =>
      document.querySelector('.octo-diff-added, .octo-diff-removed, .octo-bot-diff-empty, .octo-member-error') != null,
    { timeout: 10000 },
  )
  .catch(() => {})
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/02-diff-modal.png`, fullPage: true })

const err = page.locator('.docs-bot-diff-modal .octo-member-error')
if ((await err.count()) > 0) fail(`diff modal shows an error: "${await err.first().innerText()}"`)

const added = await page.locator('.octo-diff-added').count()
const removed = await page.locator('.octo-diff-removed').count()
const unchanged = await page.locator('.octo-diff-unchanged').count()
log(`diff rows: added=${added} removed=${removed} unchanged=${unchanged}`)
if (added === 0 && removed === 0) {
  fail('diff modal rendered NO +/- rows — the diff is empty, so the user still cannot see what changed')
} else {
  ok(`diff shows real changes (${added} added / ${removed} removed / ${unchanged} unchanged)`)
}

// Modal geometry — an unstyled/collapsed modal is the classic "I can't see it" failure.
const modalBox = await page.locator('.docs-bot-diff-modal').first().boundingBox()
log(`modal box: ${JSON.stringify(modalBox)}`)
if (!modalBox || modalBox.width < 320 || modalBox.height < 160) {
  fail(`diff modal box is too small to read: ${JSON.stringify(modalBox)}`)
} else {
  ok('diff modal has a readable box')
}
// Is the diff content actually scrolled into view / not clipped away?
const clipped = await page.evaluate(() => {
  const m = document.querySelector('.docs-bot-diff-modal')
  if (!m) return 'no-modal'
  const r = m.getBoundingClientRect()
  return r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth
    ? 'offscreen'
    : 'onscreen'
})
log(`modal placement: ${clipped}`)
if (clipped !== 'onscreen') fail(`diff modal is ${clipped}`)

// ── 4. the undo button + its second confirmation ────────────────────────────
log('\n— 4. undo (撤销) —')
const undoBtn = page.locator('.octo-bot-diff-revert-all-btn')
if ((await undoBtn.count()) === 0) {
  fail('no undo button (.octo-bot-diff-revert-all-btn) for an admin on a non-empty diff')
} else {
  log(`undo button text: "${await undoBtn.first().innerText()}" visible=${await undoBtn.first().isVisible()}`)
  ok('undo button present for admin')
  await undoBtn.first().click()
  await page.waitForSelector('.octo-bot-diff-confirm', { timeout: 5000 }).catch(() => {})
  if ((await page.locator('.octo-bot-diff-confirm').count()) === 0) {
    fail('undo did not require a second confirmation')
  } else {
    ok('undo asks for a second confirmation before writing')
    log('confirm text: ' + (await page.locator('.octo-bot-diff-confirm').first().innerText()).replace(/\n/g, ' | '))
  }
  await page.screenshot({ path: `${OUT}/03-undo-confirm.png`, fullPage: true })
  // Confirm it, and check no restore POST happened BEFORE this point.
  const before = await page.evaluate(() => window.__botDiffHarness.calls().filter((c) => c.includes('/restore')).length)
  if (before !== 0) fail(`a restore was POSTed before the user confirmed (${before} calls)`)
  else ok('no restore POST fired before confirmation')
  await page.locator('.octo-bot-diff-revert-all-confirm').first().click()
  await page.waitForSelector('.octo-bot-diff-reverted', { timeout: 8000 }).catch(() => {})
  if ((await page.locator('.octo-bot-diff-reverted').count()) === 0) {
    fail('after confirming, no success notice (.octo-bot-diff-reverted) appeared')
  } else {
    ok('undo confirmed → success notice shown')
    log('notice: ' + (await page.locator('.octo-bot-diff-reverted').first().innerText()))
  }
  await page.screenshot({ path: `${OUT}/04-undo-done.png`, fullPage: true })
}

// Close the modal.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ── 5. the "auto" tab must NOT list the safety snapshot ─────────────────────
log('\n— 5. filter tabs —')
const autoTab = page.locator('[data-panel="versions"] .octo-version-filters .octo-tb-btn').nth(2)
log(`auto tab label: "${await autoTab.innerText()}"`)
await autoTab.click()
await page.waitForTimeout(700)
const autoBotRows = await page.locator('[data-panel="versions"] .octo-version-row.is-bot-edit').count()
log(`bot-edit rows under the auto filter: ${autoBotRows}`)
if (autoBotRows !== 0) {
  fail('the auto tab shows a safety snapshot, which contradicts the backend filter (kind=auto ⇒ kind=1 only)')
} else {
  ok('auto tab correctly has no safety snapshot (users must look under 全部/手动)')
}
await page.screenshot({ path: `${OUT}/05-auto-tab.png`, fullPage: true })
// back to 'all'
await page.locator('[data-panel="versions"] .octo-version-filters .octo-tb-btn').first().click()
await page.waitForTimeout(500)

// ── 6. the @-mention candidate panel ────────────────────────────────────────
log('\n— 6. @-mention candidate panel —')
const composer = page.locator('[data-panel="mention-admin"] .octo-mention-composer .ProseMirror').first()
await composer.click()
await page.keyboard.type('@', { delay: 60 })
await page.waitForSelector('.octo-mention-menu', { timeout: 8000 }).catch(() => {})
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/06-mention-panel.png`, fullPage: true })

const menu = page.locator('.octo-mention-menu').first()
if ((await menu.count()) === 0) {
  fail('typing @ did not open .octo-mention-menu')
} else {
  const text = await menu.innerText()
  log('menu text:\n' + text.split('\n').map((l) => '    ' + l).join('\n'))
  // The 'test' bot is NOT a doc member → must not be offered.
  if (/(^|\W)test(\W|$)/.test(text)) {
    fail('the non-member bot "test" is still offered in the @ menu')
  } else {
    ok('non-member bot "test" is filtered out of the @ menu')
  }
  if (!text.includes('Lobster')) fail('the eligible writer bot "Lobster" is missing from the @ menu')
  else ok('eligible writer bot "Lobster" is offered')

  // Grouping: the prototype's whole point is that Bots and people are DIFFERENT KINDS of candidate.
  const groups = await page.locator('.octo-mention-menu .octo-mention-group').allInnerTexts()
  log(`group headings: ${JSON.stringify(groups)}`)
  if (groups.length === 0) fail('no group headings rendered — the panel is still a flat list')
  else ok(`grouped into ${groups.length} sections: ${groups.join(' / ')}`)

  // The one-line description + provenance ("<what it does> · <why you may use it>").
  const botSub = await page
    .locator('.octo-mention-option[data-kind="agent"] .octo-mention-meta small')
    .first()
    .innerText()
    .catch(() => '')
  log(`bot subtitle: "${botSub}"`)
  if (!botSub.includes('·')) fail('the Bot row has no "<description> · <relation>" subtitle')
  else ok('Bot row carries its description + relation')

  // The trailing purple pill must be a real badge element, not the literal text "· AI".
  const badges = await page.locator('.octo-mention-option .octo-mention-badge').allInnerTexts()
  log(`bot badges: ${JSON.stringify(badges)}`)
  if (badges.length === 0) fail('no .octo-mention-badge pill on any Bot row')
  else ok(`Bot pill rendered (${badges.join(', ')})`)
  if (/·\s*AI/.test(text)) fail('the old "· AI" text tag is still being rendered')

  // An SVG glyph, not an emoji.
  const glyphs = await page.locator('.octo-mention-option svg.octo-bot-glyph').count()
  log(`svg bot glyphs: ${glyphs}`)
  if (glyphs === 0) fail('Bot rows use no SVG glyph (emoji fallback?)')
  else ok('Bot rows use the SVG glyph')
  if (/🤖|📄/.test(text)) fail('an emoji icon is still being rendered in the candidate rows')

  // An OFFLINE bot that IS a doc writer must be visible but unpickable.
  const offline = page.locator('.octo-mention-option.is-disabled')
  const offlineCount = await offline.count()
  log(`disabled (offline) rows: ${offlineCount}`)
  if (offlineCount === 0) {
    fail('the offline bot is not rendered as a disabled row')
  } else {
    const t0 = (await offline.first().innerText()).replace(/\n/g, ' | ')
    log(`offline row: ${t0}`)
    const reallyDisabled = await offline.first().isDisabled()
    if (!reallyDisabled) fail('the offline row LOOKS disabled but is still clickable')
    else ok('offline bot is rendered and genuinely disabled')
  }

  const menuBox = await menu.boundingBox()
  log(`menu box: ${JSON.stringify(menuBox)}`)
}
// Crop just the popup for a close look at the visual.
const menuBox = await menu.boundingBox().catch(() => null)
if (menuBox) {
  await page.screenshot({
    path: `${OUT}/07-mention-popup-crop.png`,
    clip: {
      x: Math.max(0, menuBox.x - 8),
      y: Math.max(0, menuBox.y - 8),
      width: menuBox.width + 16,
      height: menuBox.height + 16,
    },
  })
}

// ── 7. the no-permission empty state (commenter may not @Bot) ────────────────
log('\n— 7. commenter empty state —')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const cComposer = page
  .locator('[data-panel="mention-commenter"] .octo-mention-composer .ProseMirror')
  .first()
await cComposer.click()
await page.keyboard.type('@', { delay: 60 })
await page.waitForSelector('.octo-mention-menu', { timeout: 8000 }).catch(() => {})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/08-mention-commenter.png`, fullPage: true })

const cMenu = page.locator('.octo-mention-menu').first()
if ((await cMenu.count()) === 0) {
  fail('a commenter typing @ gets NO popup at all — they never learn why there is no Bot')
} else {
  const cText = await cMenu.innerText()
  log('commenter menu text:\n' + cText.split('\n').map((l) => '    ' + l).join('\n'))
  // A commenter must see NO bot, and must be TOLD why.
  if (cText.includes('Lobster') || cText.includes('OfflineAgent')) {
    fail('a commenter is being offered a Bot candidate')
  } else {
    ok('no Bot offered to a commenter')
  }
  const notice = page.locator('.octo-mention-menu .octo-mention-empty')
  if ((await notice.count()) === 0) {
    fail('no empty-state line explaining why the Bot section is missing')
  } else {
    log(`notice: "${await notice.first().innerText()}"`)
    ok('commenter is told why they cannot @Bot')
  }
  // No heading may stand over an empty Bot group.
  const cGroups = await page.locator('.octo-mention-menu .octo-mention-group').allInnerTexts()
  log(`commenter group headings: ${JSON.stringify(cGroups)}`)
  const cBox = await cMenu.boundingBox()
  if (cBox) {
    await page.screenshot({
      path: `${OUT}/09-mention-commenter-crop.png`,
      clip: {
        x: Math.max(0, cBox.x - 8),
        y: Math.max(0, cBox.y - 8),
        width: cBox.width + 16,
        height: cBox.height + 16,
      },
    })
  }
}

await browser.close()
log('')
if (process.exitCode) console.error('=== BOTDIFF HARNESS FAILED (see failures above) ===')
else console.log('=== BOTDIFF HARNESS PASSED ===')
log(`screenshots: ${OUT}`)
