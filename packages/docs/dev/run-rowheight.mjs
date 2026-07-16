// Playwright driver for the table row-height resize handle (SCHEMA_VERSION 19). Real Chromium, a real
// left-button drag on the row's bottom-edge handle (page.mouse.down/move/up), reading the ProseMirror
// model (editor.state.doc) to verify the height changed and PERSISTED, plus a second collaborative
// peer to prove the height syncs to the other side. Reproduces the acceptance gate:
//   RH01 — drag row 1's bottom line DOWN → row 1's tableRow.height grows and persists on peer A.
//   RH02 — that new height is present on the remote peer B (协作对端一致).
//   RH03 — an untouched row keeps height=null (height=null behaves like today, no regression).
// Usage: node dev/run-rowheight.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/rowheight.html`
const OUT = 'dev/rowheight-out'
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
await page.waitForFunction(() => !!window.__rowHeightHarness, { timeout: 30000 })
await page.evaluate(() => window.__rowHeightHarness.mount())
await page.waitForTimeout(250)

console.log('\nRow-height resize — drag row 1 bottom line down, verify model + collab persistence')

const before = await page.evaluate(() => ({
  a0: window.__rowHeightHarness.rowHeightA(0),
  a1: window.__rowHeightHarness.rowHeightA(1),
  rect: window.__rowHeightHarness.rowRectA(0),
}))
console.log('  row heights before (A):', JSON.stringify({ row0: before.a0, row1: before.a1 }))
if (!before.rect) throw new Error('row 0 rect not found')

// 1) Hover near row 1's BOTTOM edge so the row-resize handle arms for that row. Grab at 1/4 width
// (inside the first cell) — NOT the row centre, which coincides with the inter-column border where
// the row handle intentionally defers to the column-resize handle.
const grabX = before.rect.left + before.rect.width / 4
const bottomY = before.rect.top + before.rect.height
await page.mouse.move(grabX, bottomY - 1)
await page.waitForTimeout(120)

// 2) Grab the handle bar and drag DOWN by a clear delta.
const handle = await page.evaluate(() => window.__rowHeightHarness.handleRect())
if (!handle) {
  fail('row-resize handle not visible after hovering the row bottom edge')
} else {
  ok('row-resize handle armed on hover of the row bottom edge')
  const startX = handle.left + handle.width / 2
  const startY = handle.top + handle.height / 2
  const DELTA = 60
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Several held moves so the drag tracks and the guide follows.
  await page.mouse.move(startX, startY + DELTA / 2, { steps: 4 })
  await page.mouse.move(startX, startY + DELTA, { steps: 4 })
  await page.waitForTimeout(40)
  await page.mouse.up()
  await page.waitForTimeout(150)

  const after = await page.evaluate(() => ({
    a0: window.__rowHeightHarness.rowHeightA(0),
    a1: window.__rowHeightHarness.rowHeightA(1),
    b0: window.__rowHeightHarness.rowHeightB(0),
    b1: window.__rowHeightHarness.rowHeightB(1),
  }))
  console.log('  row heights after  (A):', JSON.stringify({ row0: after.a0, row1: after.a1 }))
  console.log('  row heights after  (B):', JSON.stringify({ row0: after.b0, row1: after.b1 }))

  // RH01 — the dragged row now carries an explicit, larger height on peer A (persisted in the model).
  if (typeof after.a0 === 'number' && after.a0 >= (before.rect.height + DELTA - 12)) {
    ok(`RH01 row 1 height persisted on A (${after.a0}px, was content-driven ~${Math.round(before.rect.height)}px)`)
  } else {
    fail(`RH01 row 1 height did not grow as expected on A: ${JSON.stringify(after.a0)}`)
  }

  // RH02 — the same height reached the remote collaborator (协作对端一致).
  if (after.b0 === after.a0 && typeof after.b0 === 'number') {
    ok(`RH02 height synced to remote peer B (${after.b0}px)`)
  } else {
    fail(`RH02 height not consistent on remote peer B: A=${after.a0} B=${after.b0}`)
  }

  // RH03 — the untouched row 2 stays null on both peers (height=null behaves like today).
  if (after.a1 === null && after.b1 === null) {
    ok('RH03 untouched row keeps height=null on both peers (no regression)')
  } else {
    fail(`RH03 untouched row changed unexpectedly: A=${after.a1} B=${after.b1}`)
  }

  await page.screenshot({ path: `${OUT}/rowheight-after.png` })
}

// RH04 (#823 RC) — a concurrent REMOTE row insert during the drag must never write the height to the
// wrong row. Re-mount fresh, grab row 1's bottom edge, hold the drag, have peer B insert a row ABOVE
// row 1 (which shifts the dragged row down), then release. With the concurrency guard the commit ABORTS
// (data-safe): no row is left with a wrongly-applied explicit height. Before the fix, the commit wrote
// the dragged height to the stale absolute position — i.e. onto the wrong row — which this catches.
await page.evaluate(() => window.__rowHeightHarness.mount())
await page.waitForTimeout(250)

console.log('\nRH04 — concurrent remote insert-row-above during the drag must not resize the wrong row')
const rc = await page.evaluate(() => ({ rect: window.__rowHeightHarness.rowRectA(0), count: window.__rowHeightHarness.rowCountA() }))
if (!rc.rect) {
  fail('RH04 row 0 rect not found')
} else {
  const grabX = rc.rect.left + rc.rect.width / 4
  const bottomY = rc.rect.top + rc.rect.height
  await page.mouse.move(grabX, bottomY - 1)
  await page.waitForTimeout(120)
  const handle = await page.evaluate(() => window.__rowHeightHarness.handleRect())
  if (!handle) {
    fail('RH04 row-resize handle not visible on hover')
  } else {
    const startX = handle.left + handle.width / 2
    const startY = handle.top + handle.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + 30, { steps: 4 })
    // Mid-drag: a remote collaborator inserts a row above the dragged row (shifts it down by one).
    await page.evaluate(() => window.__rowHeightHarness.insertRowTopB())
    await page.waitForTimeout(60)
    await page.mouse.move(startX, startY + 60, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(150)

    const res = await page.evaluate(() => {
      const n = window.__rowHeightHarness.rowCountA()
      const heights = []
      const texts = []
      for (let i = 0; i < n; i++) {
        heights.push(window.__rowHeightHarness.rowHeightA(i))
        texts.push(window.__rowHeightHarness.rowTextA(i))
      }
      return { n, heights, texts }
    })
    console.log('  after concurrent insert — rows:', JSON.stringify(res))

    // The remote insert landed (row count grew), so the drag genuinely raced a structural change.
    if (res.n === rc.count + 1) {
      ok(`RH04 remote insert applied mid-drag (rows ${rc.count} → ${res.n})`)
    } else {
      fail(`RH04 expected the remote insert to add a row (was ${rc.count}, now ${res.n})`)
    }
    // Data-safety: the originally-dragged row ("r1…") must NOT have been given an explicit height on the
    // wrong row. With the guard the commit aborts, so every row stays height=null.
    const wrongWrite = res.texts.some((t, i) => res.heights[i] != null)
    if (!wrongWrite) {
      ok('RH04 concurrent structural edit → resize safely aborted, no row got a wrong height')
    } else {
      const i = res.heights.findIndex((h) => h != null)
      fail(`RH04 height ${res.heights[i]} written to row "${res.texts[i]}" despite a concurrent structural edit (wrong-row write)`)
    }
    await page.screenshot({ path: `${OUT}/rowheight-concurrent.png` })
  }
}

// RH05 (#823 RC2 / XIN-1244 / XIN-1252) — an INTERRUPTED drag must NOT commit a stale height (the
// row-resize analogue of TableReorderHandle FAIL-1). This reproduces the EXACT real-machine path the
// tester hit: grab row 1's bottom line, drag DOWN and OUT past the bottom of the viewport, RELEASE the
// button outside the window, then move the pointer back into the table. The drag captures the pointer,
// so the terminal pointerup is delivered with out-of-viewport coordinates — a release outside the window
// is an interruption, not a drop, so the commit is aborted and the row keeps its original (null) height.
// Before this fix the release committed the last tracked (stale) height, e.g. ~1089px onto row 1.
console.log('\nRH05 — release the drag OUTSIDE the viewport, then return: must not commit a stale height')
await page.evaluate(() => window.__rowHeightHarness.mount())
await page.waitForTimeout(250)

const beforeI = await page.evaluate(() => ({
  a0: window.__rowHeightHarness.rowHeightA(0),
  rect: window.__rowHeightHarness.rowRectA(0),
}))
const viewport = page.viewportSize() || { width: 1400, height: 900 }
if (beforeI.a0 !== null) {
  fail(`RH05 precondition: row 1 height should start null, was ${JSON.stringify(beforeI.a0)}`)
} else if (!beforeI.rect) {
  fail('RH05 precondition: row 0 rect not found')
} else {
  const grabXi = beforeI.rect.left + beforeI.rect.width / 4
  const bottomYi = beforeI.rect.top + beforeI.rect.height
  await page.mouse.move(grabXi, bottomYi - 1)
  await page.waitForTimeout(120)
  const handleI = await page.evaluate(() => window.__rowHeightHarness.handleRect())
  if (!handleI) {
    fail('RH05 row-resize handle not visible after hovering the row bottom edge')
  } else {
    const sx = handleI.left + handleI.width / 2
    const sy = handleI.top + handleI.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    // Real held moves that grow the pending height, then drag the pointer BELOW the viewport bottom.
    await page.mouse.move(sx, sy + 200, { steps: 4 })
    await page.mouse.move(sx, viewport.height + 300, { steps: 4 }) // pointer now OUTSIDE the window
    // Release the button OUTSIDE the window. Pointer capture still delivers this terminal pointerup.
    await page.mouse.up()
    // Move the pointer back into the table (the "移回表格" step). Must not resurrect a commit.
    await page.mouse.move(sx, sy + 40, { steps: 3 })
    await page.waitForTimeout(150)

    const afterI = await page.evaluate(() => ({
      a0: window.__rowHeightHarness.rowHeightA(0),
      b0: window.__rowHeightHarness.rowHeightB(0),
    }))
    console.log('  row 1 height after outside-window release (A/B):', JSON.stringify(afterI))
    if (afterI.a0 === null && afterI.b0 === null) {
      ok('RH05 outside-window release aborted — row height stayed null on both peers')
    } else {
      fail(`RH05 outside-window release committed a stale height: A=${afterI.a0} B=${afterI.b0}`)
    }
    await page.screenshot({ path: `${OUT}/rowheight-interrupt.png` })
  }
}

await browser.close()
if (failed) {
  console.error(`\n=== ROW-HEIGHT HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== ROW-HEIGHT HARNESS PASSED: drag resizes + persists + syncs to the remote peer ===')
}
