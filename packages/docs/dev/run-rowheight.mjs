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

await browser.close()
if (failed) {
  console.error(`\n=== ROW-HEIGHT HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== ROW-HEIGHT HARNESS PASSED: drag resizes + persists + syncs to the remote peer ===')
}
