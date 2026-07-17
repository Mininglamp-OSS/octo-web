// Playwright driver for the column-hover row-jump gate (XIN-1322). Real Chromium, a real pointer
// parked on the border between two columns to arm prosemirror-tables' columnResizing (which mounts
// the `.column-resize-handle` / `.ProseMirror-widget` DIV at the end of the cell's `.octo-cell-clip`).
// Reproduces the acceptance gate:
//   CH01 — hovering the column border mounts the resize-handle widget (the transient's trigger fires).
//   CH02 — while the widget is mounted, every row's rendered height stays within 1px of its rest
//          height (no ~15px jump). Before the fix the trailing <p> lost `:last-child` and its
//          margin-bottom sprang back, pushing each row taller.
//   CH03 — the trailing <p>'s computed margin-bottom stays ~0 even with the widget mounted after it.
//   CH04 — moving the pointer off the border unmounts the widget and the height fully restores.
// Usage: node dev/run-colhover.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/colhover.html`
const OUT = 'dev/colhover-out'
mkdirSync(OUT, { recursive: true })

let failed = 0
const fail = (msg) => {
  console.error('  ✗ FAIL:', msg)
  failed++
}
const ok = (msg) => console.log('  ✓', msg)

// Allow pinning a specific Chromium binary (e.g. the full build) via env when the default
// chrome-headless-shell is not present in the cache. No effect when unset.
const launchOpts = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
const browser = await chromium.launch(launchOpts)
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()) })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__colHoverHarness, { timeout: 30000 })
await page.evaluate(() => window.__colHoverHarness.mount())
await page.waitForTimeout(300)

console.log('\nColumn-hover row jump — arm columnResizing on the inter-column border, verify no row growth')

// 1) Rest state: widget absent, capture each row's rendered height.
const rest = await page.evaluate(() => ({
  handle: window.__colHoverHarness.hasResizeHandle(),
  r0: window.__colHoverHarness.rowRect(0),
  r1: window.__colHoverHarness.rowRect(1),
  margin: window.__colHoverHarness.lastParaMarginBottom(),
  border: window.__colHoverHarness.colBorderPoint(),
}))
console.log('  at rest:', JSON.stringify({ handle: rest.handle, r0h: rest.r0?.height, r1h: rest.r1?.height, margin: rest.margin }))
if (!rest.r0 || !rest.r1) throw new Error('row rects not found at rest')
if (!rest.border) throw new Error('column border point not found')
if (rest.handle) fail('precondition: resize handle should be absent before hovering the border')
else ok('precondition: no resize handle at rest')

// 2) Park the pointer ON the inter-column border to arm columnResizing. Approach in small steps so the
//    plugin's mousemove handler sees a move that lands inside the handleWidth band.
await page.mouse.move(rest.border.x - 40, rest.border.y)
await page.waitForTimeout(60)
await page.mouse.move(rest.border.x, rest.border.y, { steps: 6 })
await page.waitForTimeout(200)

const hover = await page.evaluate(() => ({
  handle: window.__colHoverHarness.hasResizeHandle(),
  r0: window.__colHoverHarness.rowRect(0),
  r1: window.__colHoverHarness.rowRect(1),
  margin: window.__colHoverHarness.lastParaMarginBottom(),
}))
console.log('  while hovering border:', JSON.stringify({ handle: hover.handle, r0h: hover.r0?.height, r1h: hover.r1?.height, margin: hover.margin }))

// CH01 — the widget must actually mount, otherwise the test proves nothing.
if (hover.handle) ok('CH01 hovering the column border mounted the resize-handle widget')
else fail('CH01 resize-handle widget did not mount on border hover — cannot exercise the transient')

// CH02 — no row grew while the widget is mounted.
const d0 = Math.abs((hover.r0?.height ?? 0) - rest.r0.height)
const d1 = Math.abs((hover.r1?.height ?? 0) - rest.r1.height)
if (hover.handle && d0 <= 1 && d1 <= 1) {
  ok(`CH02 rows held their height with the widget mounted (Δrow1=${d0.toFixed(1)}px, Δrow2=${d1.toFixed(1)}px)`)
} else if (hover.handle) {
  fail(`CH02 a row grew while the widget was mounted: Δrow1=${d0.toFixed(1)}px, Δrow2=${d1.toFixed(1)}px (expected ≤1px each)`)
}

// CH03 — the trailing <p> kept its zeroed margin-bottom despite the widget sitting after it.
if (hover.handle && typeof hover.margin === 'number' && hover.margin <= 1) {
  ok(`CH03 trailing <p> margin-bottom stayed ~0 with widget mounted (${hover.margin}px)`)
} else if (hover.handle) {
  fail(`CH03 trailing <p> margin-bottom sprang back to ${hover.margin}px (expected ~0)`)
}
await page.screenshot({ path: `${OUT}/colhover-armed.png` })

// 3) Move the pointer well away so the widget unmounts.
await page.mouse.move(rest.border.x, rest.border.y - 200, { steps: 4 })
await page.mouse.move(200, 100, { steps: 4 })
await page.waitForTimeout(200)
const after = await page.evaluate(() => ({
  handle: window.__colHoverHarness.hasResizeHandle(),
  r0: window.__colHoverHarness.rowRect(0),
  r1: window.__colHoverHarness.rowRect(1),
}))
console.log('  after moving away:', JSON.stringify({ handle: after.handle, r0h: after.r0?.height, r1h: after.r1?.height }))

// CH04 — widget gone and height fully restored (proves no permanent change either way).
const rd0 = Math.abs((after.r0?.height ?? 0) - rest.r0.height)
const rd1 = Math.abs((after.r1?.height ?? 0) - rest.r1.height)
if (!after.handle && rd0 <= 1 && rd1 <= 1) {
  ok('CH04 widget unmounted and rows restored to rest height on pointer-away')
} else {
  fail(`CH04 after pointer-away: handle=${after.handle}, Δrow1=${rd0.toFixed(1)}px, Δrow2=${rd1.toFixed(1)}px`)
}
await page.screenshot({ path: `${OUT}/colhover-restored.png` })

await browser.close()
if (failed) {
  console.error(`\n=== COLUMN-HOVER HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== COLUMN-HOVER HARNESS PASSED: column-border hover mounts the widget without growing any row ===')
}
