// Playwright driver for the table reorder concurrency guard (octo-docs-backend#76 / XIN-1225).
// Real Chromium, real left-button drag on the row reorder handle, with a genuine concurrent remote
// transaction (peer B) arriving mid-drag. Reproduces:
//   TC01 — remote edits PROSE OUTSIDE the dragged table  → reorder must COMPLETE (no abort).
//   TC02 — remote edits an identical SECOND table         → reorder must COMPLETE (no abort).
//   TC03 — remote reorders the SAME dragged table         → reorder must ABORT (data-safety guard).
// Usage: node dev/run-reorder.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/reorder.html`
const OUT = 'dev/reorder-out'
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

/** Perform a full row-2→top drag on peer A, firing `remoteFn` (a __reorderHarness method name) mid-drag.
 *  Returns { grid, abortDebug } observed after mouseup. */
async function dragRowWithConcurrentEdit(remoteFn) {
  // Arm the guard debug sink fresh for this run.
  await page.evaluate(() => {
    window.__reorderAbortDebug = []
    window.__tableReorderDebug = []
  })

  // 1) Hover over the source cell (row 2, col 0) so the row grab handle appears for that row.
  const src = await page.evaluate(() => window.__reorderHarness.cellRectA(2, 0))
  if (!src) throw new Error('source cell rect not found')
  await page.mouse.move(src.left + src.width / 2, src.top + src.height / 2)
  await page.waitForTimeout(80)

  // 2) Grab the row handle (sits in the left gutter at the hovered row's Y).
  const handle = await page.evaluate(() => window.__reorderHarness.handleRect('row'))
  if (!handle) throw new Error('row handle not visible after hover')
  await page.mouse.move(handle.left + handle.width / 2, handle.top + handle.height / 2)
  await page.mouse.down()

  // 3) Drag up toward row 0. Several held moves so pointerHeldSeen latches and dropIndex resolves.
  const dst = await page.evaluate(() => window.__reorderHarness.cellRectA(0, 0))
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 6 })
  await page.waitForTimeout(50)

  // 4) Fire the concurrent remote edit on peer B — it reaches A as a real transaction mid-drag.
  await page.evaluate((fn) => window.__reorderHarness[fn](), remoteFn)
  await page.waitForTimeout(50)

  // 5) Re-settle the drop target on the now-updated document, then release.
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2 - 2, { steps: 3 })
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 3 })
  await page.waitForTimeout(30)
  await page.mouse.up()
  await page.waitForTimeout(120)

  return await page.evaluate(() => ({
    grid: window.__reorderHarness.gridA(),
    abortDebug: window.__reorderAbortDebug,
    dispatchDebug: window.__tableReorderDebug,
  }))
}

const firstColMoved = (grid) => grid.map((r) => r[0])

/** A plain row-2→top drag on peer A with NO concurrent edit (the happy path). */
async function dragRowNoConcurrent() {
  await page.evaluate(() => {
    window.__reorderAbortDebug = []
    window.__tableReorderDebug = []
  })
  const src = await page.evaluate(() => window.__reorderHarness.cellRectA(2, 0))
  await page.mouse.move(src.left + src.width / 2, src.top + src.height / 2)
  await page.waitForTimeout(80)
  const handle = await page.evaluate(() => window.__reorderHarness.handleRect('row'))
  if (!handle) throw new Error('row handle not visible after hover')
  await page.mouse.move(handle.left + handle.width / 2, handle.top + handle.height / 2)
  await page.mouse.down()
  const dst = await page.evaluate(() => window.__reorderHarness.cellRectA(0, 0))
  await page.mouse.move(dst.left + dst.width / 2, dst.top + dst.height / 2, { steps: 6 })
  await page.waitForTimeout(30)
  await page.mouse.up()
  await page.waitForTimeout(100)
  return await page.evaluate(() => window.__reorderHarness.gridA())
}

// ── TC01 ────────────────────────────────────────────────────────────────────────────────────────
console.log('\nTC01 — remote prose edit OUTSIDE the dragged table (must NOT abort)')
await page.evaluate(() => window.__reorderHarness.mountSingle())
await page.waitForTimeout(200)
{
  const before = await page.evaluate(() => window.__reorderHarness.gridA())
  console.log('  grid before:', JSON.stringify(firstColMoved(before)))
  const { grid, abortDebug, dispatchDebug } = await dragRowWithConcurrentEdit('remoteProseEdit')
  console.log('  grid after :', JSON.stringify(firstColMoved(grid)))
  console.log('  abortDebug :', JSON.stringify(abortDebug))
  const aborted = abortDebug.some((e) => e.conflict)
  const moved = grid[0][0] === 'r3c1'
  const dispatched = dispatchDebug.some((e) => e.phase === 'dispatch' && e.dispatched)
  if (aborted) fail('TC01 guard aborted on an OUTSIDE prose edit')
  else ok('guard did not abort on outside prose edit')
  if (!moved) fail(`TC01 reorder did not complete (row 3 not at top): ${JSON.stringify(firstColMoved(grid))}`)
  else ok('reorder completed — r3 row moved to top')
  if (!dispatched) fail('TC01 move command was never dispatched')
  await page.screenshot({ path: `${OUT}/tc01-after.png` })
}

// ── TC02 ────────────────────────────────────────────────────────────────────────────────────────
console.log('\nTC02 — remote edit of an identical SECOND table (must NOT abort)')
await page.evaluate(() => window.__reorderHarness.mountTwins())
await page.waitForTimeout(200)
{
  const before = await page.evaluate(() => window.__reorderHarness.gridA())
  console.log('  grid before:', JSON.stringify(firstColMoved(before)))
  const { grid, abortDebug } = await dragRowWithConcurrentEdit('remoteSecondTableEdit')
  console.log('  grid after :', JSON.stringify(firstColMoved(grid)))
  console.log('  abortDebug :', JSON.stringify(abortDebug))
  const aborted = abortDebug.some((e) => e.conflict)
  const moved = grid[0][0] === 'r3c1'
  if (aborted) fail('TC02 guard aborted on an edit to the OTHER identical table')
  else ok('guard did not abort on identical-second-table edit')
  if (!moved) fail(`TC02 reorder did not complete: ${JSON.stringify(firstColMoved(grid))}`)
  else ok('reorder completed — r3 row moved to top')
  await page.screenshot({ path: `${OUT}/tc02-after.png` })
}

// ── TC03 ────────────────────────────────────────────────────────────────────────────────────────
console.log('\nTC03 — remote reorder of the SAME dragged table (MUST abort — data-safety guard)')
await page.evaluate(() => window.__reorderHarness.mountSingle())
await page.waitForTimeout(200)
{
  const { grid, abortDebug } = await dragRowWithConcurrentEdit('remoteReorderFirstTable')
  console.log('  grid after :', JSON.stringify(firstColMoved(grid)))
  console.log('  abortDebug :', JSON.stringify(abortDebug))
  const aborted = abortDebug.some((e) => e.conflict)
  if (!aborted) fail('TC03 guard did NOT abort on a concurrent same-table reorder (data-safety hole)')
  else ok('guard aborted on concurrent same-table reorder — data-safety preserved')
  await page.screenshot({ path: `${OUT}/tc03-after.png` })
}

// ── TC08 ────────────────────────────────────────────────────────────────────────────────────────
console.log('\nTC08 — new document / table-only context: reorder works and is stable (no regression)')
await page.evaluate(() => window.__reorderHarness.mountNewDoc())
await page.waitForTimeout(200)
{
  const before = await page.evaluate(() => window.__reorderHarness.gridA())
  console.log('  grid before  :', JSON.stringify(firstColMoved(before)))
  const g1 = await dragRowNoConcurrent() // r3 -> top
  console.log('  after drag #1:', JSON.stringify(firstColMoved(g1)))
  if (g1[0][0] !== 'r3c1') fail(`TC08 first reorder failed on a new doc: ${JSON.stringify(firstColMoved(g1))}`)
  else ok('reorder works on a fresh table-only document')
  // Stability: a second reorder must also apply cleanly, not wedge the handles into the unusable state.
  const expectSecond = g1[2][0]
  const g2 = await dragRowNoConcurrent()
  console.log('  after drag #2:', JSON.stringify(firstColMoved(g2)))
  if (g2[0][0] !== expectSecond) fail(`TC08 second consecutive reorder unstable: ${JSON.stringify(firstColMoved(g2))}`)
  else ok('second consecutive reorder is stable (handles not wedged)')
  await page.screenshot({ path: `${OUT}/tc08-after.png` })
}

await browser.close()
if (failed) {
  console.error(`\n=== REORDER HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== REORDER HARNESS PASSED: TC01 + TC02 complete, TC03 aborts ===')
}
