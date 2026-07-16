// Playwright driver for the reorder-handle COEXISTENCE gate (octo-docs-backend#76 / XIN-1253).
// Real Chromium, real mouse, real editor/styles.css. Reproduces the reported :3000 FAIL and proves
// the fix: hover a cell → reorder handles appear → glide the pointer DOWN onto the sibling row-resize
// overlay at the row's bottom edge and wait PAST the hide grace period → the reorder handles must
// STAY visible (before the fix the editor's mouseleave hid them and they could not be grabbed) → then
// grab the column handle and complete a reorder.
//
// RED (pre-fix TableReorderHandle.ts): "reorder handles VANISHED …". GREEN (fixed): all ✓.
// Usage: node dev/run-coexist.mjs   (expects the standalone dev server; pass HARNESS_PORT)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/coexist.html`
const OUT = 'dev/coexist-out'
mkdirSync(OUT, { recursive: true })

let failed = 0
const fail = (msg) => {
  console.error('  ✗ FAIL:', msg)
  failed++
}
const ok = (msg) => console.log('  ✓', msg)
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const vis = (page) =>
  page.evaluate(() => ({
    row: !!window.__coexistHarness.handleRect('row'),
    col: !!window.__coexistHarness.handleRect('col'),
    overlay: (document.querySelector('.octo-row-resize-standin') || {}).style?.display !== 'none',
  }))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__coexistHarness, { timeout: 30000 })
await page.waitForTimeout(300)

console.log('\nXIN-1253 — reorder handle survives the sibling row-resize overlay + still reorders')
await page.evaluate(() => window.__coexistHarness.reset())
await page.waitForTimeout(200)

const cell = await page.evaluate(() => window.__coexistHarness.cellRectA(1, 1))
if (!cell) throw new Error('cell rect not found — table did not render')

// 1) hover the cell centre → reorder handles must appear (baseline).
await page.mouse.move(...Object.values(center(cell)))
await page.waitForTimeout(180)
let s = await vis(page)
if (!s.row || !s.col) fail(`handles did not appear on cell hover: ${JSON.stringify(s)}`)
else ok('handles appear on cell hover')
await page.screenshot({ path: `${OUT}/1-hover.png` })

// 2) glide DOWN onto the sibling row-resize overlay at the row's bottom edge, past the grace period.
for (let y = cell.top + cell.height / 2; y <= cell.top + cell.height + 1; y += 4) {
  await page.mouse.move(cell.left + cell.width / 2, y)
  await page.waitForTimeout(20)
}
await page.waitForTimeout(400) // > HIDE_DELAY (220ms)
const topEl = await page.evaluate(
  ([x, y]) => {
    const e = document.elementFromPoint(x, y)
    return e ? e.className || e.tagName : null
  },
  [cell.left + cell.width / 2, cell.top + cell.height],
)
s = await vis(page)
console.log(`    topmost element at row bottom edge: ${topEl} | handles: ${JSON.stringify(s)}`)
await page.screenshot({ path: `${OUT}/2-over-overlay.png` })
if (!s.overlay) fail('stand-in overlay did not arm at the row bottom edge — gate not exercising the hazard')
if (!s.row || !s.col) fail('reorder handles VANISHED when the pointer moved onto the row-resize overlay (XIN-1253 defect)')
else ok('reorder handles stay visible over the overlay (no display:none regression)')

// 3) the reorder must still be triggerable via the column handle.
await page.evaluate(() => window.__coexistHarness.reset())
await page.waitForTimeout(200)
const c3 = await page.evaluate(() => window.__coexistHarness.cellRectA(0, 2))
await page.mouse.move(...Object.values(center(c3)))
await page.waitForTimeout(180)
const handle = await page.evaluate(() => window.__coexistHarness.handleRect('col'))
if (!handle) fail('column handle not visible — cannot start a reorder')
else {
  const h = center(handle)
  await page.mouse.move(h.x, h.y, { steps: 10 })
  await page.waitForTimeout(60)
  await page.mouse.down()
  const dst = await page.evaluate(() => window.__coexistHarness.cellRectA(0, 0))
  await page.mouse.move(...Object.values(center(dst)), { steps: 10 })
  await page.waitForTimeout(60)
  await page.mouse.up()
  await page.waitForTimeout(180)
  const grid = await page.evaluate(() => window.__coexistHarness.gridA())
  if (grid[0][0] === 'r1c3') ok('column 3 reorder completes via the handle')
  else fail(`column reorder did not complete: ${JSON.stringify(grid[0])}`)
  await page.screenshot({ path: `${OUT}/3-reordered.png` })
}

await browser.close()
if (failed) {
  console.error(`\n=== COEXISTENCE GATE FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== COEXISTENCE GATE PASSED: handle survives the overlay + reorder works ===')
}
