// Playwright driver for the table reorder multi-pointer re-entrancy blockers (octo-docs-backend#76
// P1-1 / P1-2), the two defects the pointer-event migration introduced and reviewers flagged on #822.
//
// The drag now runs on Pointer Events + setPointerCapture. This gate drives a REAL captured pointer
// (a genuine left-button mouse drag on the row handle — the mouse is a real, capturable pointer in
// Chromium, so setPointerCapture latches its id) and then fires a SECOND, foreign pointer at the
// document while that drag is in flight, exactly as a second finger / stylus would during a real
// multi-pointer interaction:
//   P1-1 — a second `pointerdown` on the OTHER handle must NOT start a second drag (beginDrag bails on
//          an active drag). Observable: exactly one `begin` debug event; the original ROW reorder still
//          commits (identity not clobbered); a following reorder still works (no leaked capture / wedge).
//   P1-2 — a second, uncaptured pointer's `pointerup` must NOT end the drag (onDocUp filters on the
//          captured pointer id). Observable: no dispatch / no grid change on the foreign release; the
//          owning release then commits the intended reorder.
//
// The primary pointer is a real captured browser pointer; the interfering second pointer is dispatched
// as a genuine DOM PointerEvent with a distinct pointerId (a real cross-browser way to inject a second
// pointer without a touchscreen). Deterministic jsdom coverage of the same two defects lives in
// src/editor/TableReorderMultiPointer.test.ts.
// Usage: HARNESS_PORT=<port> node dev/run-multipointer.mjs   (expects the standalone dev server running)
import { chromium } from '@playwright/test'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/reorder.html`
const OUT = 'dev/multipointer-out'
import { mkdirSync } from 'node:fs'
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

const FOREIGN_ID = 99 // a pointer id that is NOT the captured mouse pointer

/** Hover the source cell and press the row handle with a real left-button drag, then a held move over
 *  the target so a drop resolves. Leaves the drag in flight (mouse button still down). */
async function armRealRowDrag() {
  await page.evaluate(() => {
    window.__tableReorderDebug = []
    window.__reorderAbortDebug = []
  })
  const src = await page.evaluate(() => window.__reorderHarness.cellRectA(2, 0))
  if (!src) throw new Error('source cell rect not found')
  await page.mouse.move(src.left + src.width / 2, src.top + src.height / 2)
  await page.waitForTimeout(80)
  const handle = await page.evaluate(() => window.__reorderHarness.handleRect('row'))
  if (!handle) throw new Error('row handle not visible after hover')
  await page.mouse.move(handle.left + handle.width / 2, handle.top + handle.height / 2)
  await page.mouse.down()
  const dst = await page.evaluate(() => window.__reorderHarness.cellRectA(0, 0))
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 6 })
  await page.waitForTimeout(30)
  return { dst }
}

const firstCol = (grid) => grid.map((r) => r[0])
const beginCount = (dbg) => dbg.filter((e) => e.phase === 'begin').length

// ── P1-1 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('\nP1-1 — a second pointerdown on the other handle must not clobber the in-flight drag')
await page.evaluate(() => window.__reorderHarness.mountSingle())
await page.waitForTimeout(200)
{
  const before = await page.evaluate(() => window.__reorderHarness.gridA())
  const { dst } = await armRealRowDrag()

  // A second finger presses the COLUMN handle mid-drag (distinct pointerId).
  await page.evaluate((pid) => {
    const col = document.querySelector('.octo-table-reorder--col')
    if (!col) throw new Error('col handle not present')
    const r = col.getBoundingClientRect()
    col.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: pid,
        button: 0,
        buttons: 1,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
      }),
    )
  }, FOREIGN_ID)
  await page.waitForTimeout(20)

  // Release the OWNING (mouse) pointer inside the window — the original ROW reorder must commit.
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(120)

  const dbg = await page.evaluate(() => window.__tableReorderDebug)
  const grid = await page.evaluate(() => window.__reorderHarness.gridA())
  const begins = beginCount(dbg)
  console.log('  begin events:', begins, JSON.stringify(dbg.filter((e) => e.phase === 'begin')))
  console.log('  grid before:', JSON.stringify(firstCol(before)), '→ after:', JSON.stringify(firstCol(grid)))
  if (begins !== 1) fail(`P1-1 a second beginDrag ran (${begins} begin events) — active-drag guard missing`)
  else ok('second pointerdown was a no-op (exactly one begin)')
  if (grid[0][0] !== 'r3c1') fail(`P1-1 the row reorder did not commit correctly: ${JSON.stringify(firstCol(grid))}`)
  else ok('original ROW reorder committed (identity not clobbered)')

  // No wedge / capture leak: a following independent reorder still works.
  await page.evaluate(() => window.__reorderHarness.mountSingle())
  await page.waitForTimeout(150)
  const after2 = await (async () => {
    const { dst } = await armRealRowDrag()
    await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 2 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    return page.evaluate(() => window.__reorderHarness.gridA())
  })()
  if (after2[0][0] !== 'r3c1') fail(`P1-1 handles wedged after the multi-pointer drag: ${JSON.stringify(firstCol(after2))}`)
  else ok('a subsequent reorder still works (no leaked capture / wedge)')
  await page.screenshot({ path: `${OUT}/p1-1-after.png` })
}

// ── P1-2 ──────────────────────────────────────────────────────────────────────────────────────────
console.log('\nP1-2 — a foreign pointer’s pointerup must not end the drag')
await page.evaluate(() => window.__reorderHarness.mountSingle())
await page.waitForTimeout(200)
{
  const before = await page.evaluate(() => window.__reorderHarness.gridA())
  const { dst } = await armRealRowDrag()

  // A second, uncaptured pointer lifts elsewhere in the document. Its pointerup reaches the
  // capture-phase onDocUp; without the id filter this ends the drag and commits the reorder mid-drag.
  await page.evaluate((pid) => {
    document.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: pid, clientX: 40, clientY: 40, bubbles: true }),
    )
  }, FOREIGN_ID)
  await page.waitForTimeout(40)

  const midGrid = await page.evaluate(() => window.__reorderHarness.gridA())
  const midDbg = await page.evaluate(() => window.__tableReorderDebug)
  const committedEarly = midDbg.some((e) => e.phase === 'dispatch' && e.dispatched)
  if (committedEarly || JSON.stringify(midGrid) !== JSON.stringify(before)) {
    fail(`P1-2 a foreign pointerup ended the drag / committed early: ${JSON.stringify(firstCol(midGrid))}`)
  } else {
    ok('foreign pointerup was ignored — drag still in flight, nothing committed')
  }

  // The OWNING (mouse) release then commits the intended reorder.
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const finalGrid = await page.evaluate(() => window.__reorderHarness.gridA())
  console.log('  grid before:', JSON.stringify(firstCol(before)), '→ final:', JSON.stringify(firstCol(finalGrid)))
  if (finalGrid[0][0] !== 'r3c1') fail(`P1-2 the owning release did not commit the reorder: ${JSON.stringify(firstCol(finalGrid))}`)
  else ok('the owning pointer’s release committed the reorder')
  await page.screenshot({ path: `${OUT}/p1-2-after.png` })
}

await browser.close()
if (failed) {
  console.error(`\n=== MULTI-POINTER HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== MULTI-POINTER HARNESS PASSED: P1-1 guard + P1-2 pointer-id filter hold in a real browser ===')
}
