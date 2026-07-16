// Playwright driver for the table reorder HANDLE UX gate (octo-docs-backend#76 / XIN-1233).
// Real Chromium, real mouse. Reproduces the reported defect and proves the fix:
//   "hover table → handle appears → move the pointer onto the handle → it must NOT disappear →
//    trigger the move successfully."
// Before the fix the handle was hidden the instant the pointer left a cell for the gutter, so the
// pointer never reached it; step (3) below would find the handle hidden. With the deferred-hide +
// flush placement the handle stays put and the drag completes.
// Usage: node dev/run-handle-ux.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/reorder.html`
const OUT = 'dev/handle-ux-out'
mkdirSync(OUT, { recursive: true })

let failed = 0
const fail = (msg) => {
  console.error('  ✗ FAIL:', msg)
  failed++
}
const ok = (msg) => console.log('  ✓', msg)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__reorderHarness, { timeout: 30000 })

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

/** Hover a cell, then glide onto the handle of `kind` in small steps (crossing the gutter dead
 *  space), pausing on the handle LONGER than the hide grace period, and assert it stays visible. */
async function handleStaysVisibleOnApproach(kind, srcRow, srcCol) {
  await page.evaluate(() => window.__reorderHarness.mountNewDoc())
  await page.waitForTimeout(200)

  // 1) Hover the source cell → the handle should appear for that row/column.
  const cell = await page.evaluate((rc) => window.__reorderHarness.cellRectA(rc[0], rc[1]), [srcRow, srcCol])
  if (!cell) throw new Error('source cell rect not found')
  const c = center(cell)
  await page.mouse.move(c.x, c.y)
  await page.waitForTimeout(120)
  const shown = await page.evaluate((k) => window.__reorderHarness.handleRect(k), kind)
  if (!shown) {
    fail(`[${kind}] handle did not appear on cell hover`)
    return null
  }
  ok(`[${kind}] handle appears on cell hover`)

  // 2) Glide from the cell onto the handle in several steps — this is the path that used to hide it.
  const h = center(shown)
  await page.mouse.move(h.x, h.y, { steps: 12 })

  // 3) Rest on the handle PAST the grace period (220ms). It must remain visible — the core gate.
  await page.waitForTimeout(400)
  const stillThere = await page.evaluate((k) => window.__reorderHarness.handleRect(k), kind)
  if (!stillThere) {
    fail(`[${kind}] handle DISAPPEARED after the pointer moved onto it (the XIN-1233 defect)`)
    return null
  }
  ok(`[${kind}] handle stays visible after the pointer rests on it (no "移开就消失")`)
  return stillThere
}

// ── UX01 — row handle: hover → stable → move onto handle → drag → reorder ────────────────────────
console.log('\nUX01 — ROW handle stays reachable and completes a move')
{
  const handle = await handleStaysVisibleOnApproach('row', 2, 0) // hover row 3
  if (handle) {
    const h = center(handle)
    await page.mouse.down()
    const dst = await page.evaluate(() => window.__reorderHarness.cellRectA(0, 0)) // toward row 1
    const d = center(dst)
    await page.mouse.move(d.x, d.y, { steps: 8 })
    await page.waitForTimeout(40)
    await page.mouse.up()
    await page.waitForTimeout(120)
    await page.screenshot({ path: `${OUT}/ux01-row-after.png` })
    const grid = await page.evaluate(() => window.__reorderHarness.gridA())
    if (grid[0][0] === 'r3c1') ok('row 3 moved to the top — reorder triggered via the handle')
    else fail(`row reorder did not complete: ${JSON.stringify(grid.map((r) => r[0]))}`)
  }
}

// ── UX02 — column handle: hover → stable → move onto handle → drag → reorder ─────────────────────
console.log('\nUX02 — COLUMN handle stays reachable and completes a move')
{
  const handle = await handleStaysVisibleOnApproach('col', 0, 1) // hover column 2
  if (handle) {
    const h = center(handle)
    await page.mouse.down()
    const dst = await page.evaluate(() => window.__reorderHarness.cellRectA(0, 0)) // toward column 1
    const d = center(dst)
    await page.mouse.move(d.x, d.y, { steps: 8 })
    await page.waitForTimeout(40)
    await page.mouse.up()
    await page.waitForTimeout(120)
    await page.screenshot({ path: `${OUT}/ux02-col-after.png` })
    const grid = await page.evaluate(() => window.__reorderHarness.gridA())
    if (grid[0][0] === 'r1c2') ok('column 2 moved to the left — reorder triggered via the handle')
    else fail(`column reorder did not complete: ${JSON.stringify(grid[0])}`)
  }
}

// ── UX03 — a real departure still hides the handle (no sticky handle) ─────────────────────────────
console.log('\nUX03 — moving the pointer far away still clears the handle (grace period is bounded)')
{
  await page.evaluate(() => window.__reorderHarness.mountNewDoc())
  await page.waitForTimeout(150)
  const cell = await page.evaluate(() => window.__reorderHarness.cellRectA(1, 0))
  const c = center(cell)
  await page.mouse.move(c.x, c.y)
  await page.waitForTimeout(120)
  if (!(await page.evaluate(() => window.__reorderHarness.handleRect('row')))) fail('handle not shown before departure test')
  // Move well away from the table and wait past the grace period.
  await page.mouse.move(1350, 850, { steps: 6 })
  await page.waitForTimeout(400)
  const gone = !(await page.evaluate(() => window.__reorderHarness.handleRect('row')))
  if (gone) ok('handle hides after the pointer genuinely leaves the table')
  else fail('handle stayed visible after the pointer left the table (sticky handle)')
  await page.screenshot({ path: `${OUT}/ux03-departed.png` })
}

await browser.close()
if (failed) {
  console.error(`\n=== HANDLE UX GATE FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== HANDLE UX GATE PASSED: handle reachable + stable + triggers move (row & col), clears on real departure ===')
}
