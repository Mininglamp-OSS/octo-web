// PROD-FAITHFUL row-height shrink harness (SCHEMA_VERSION 19, XIN-1250). Companion to
// dev/run-rowheight.mjs, which drives the minimal harness and only proves a row can GROW + persist +
// sync. The boss's bug ("只能拖高不能拖矮") only reproduces with the PRODUCTION editor wiring — the
// self-built TableCellView cell NodeView + the real editor/styles.css — because a `height` on a <tr>
// is merely a MINIMUM in CSS table layout, so a row whose content is taller than the drag target used
// to be held open and could not shrink. This harness loads rowheight-prod.html (real styles.css,
// TableCellView node views, wrapped in .octo-prose) and drives a real Chromium drag to assert:
//   RS01 — a row whose content is TALLER than the target shrinks below its content height (THE FIX;
//          before it, model shrank but the rendered <tr> stayed stuck at the content height).
//   RS02 — a grown row drags back down (grow-then-shrink round trip).
//   RS03 — the column-resize handle stays full-height + grabbable on a shrunk/clipped row, and a
//          column drag still resizes it (the cell content clip must not swallow the resize handle).
// Usage: node dev/run-rowheight-shrink.mjs   (expects dev:standalone; HARNESS_PORT overrides 4178)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/rowheight-prod.html`
const OUT = 'dev/rowheight-out'
mkdirSync(OUT, { recursive: true })

let failed = 0
const fail = (m) => { console.error('  ✗ FAIL:', m); failed++ }
const ok = (m) => console.log('  ✓', m)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()) })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__rowHeightHarness, { timeout: 30000 })

// Grab row 0's bottom-edge handle and drag it by deltaY (negative = up = shrink). Grab at 1/4 width,
// inside the first cell, away from the column-border corner where the row handle defers to col-resize.
async function dragRow0(deltaY) {
  const rect = await page.evaluate(() => window.__rowHeightHarness.rowRectA(0))
  await page.mouse.move(rect.left + rect.width / 4, rect.top + rect.height - 1)
  await page.waitForTimeout(120)
  const handle = await page.evaluate(() => window.__rowHeightHarness.handleRect())
  if (!handle) throw new Error('row-resize handle not armed on the row bottom edge')
  const sx = handle.left + handle.width / 2
  const sy = handle.top + handle.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx, sy + deltaY / 2, { steps: 6 })
  await page.mouse.move(sx, sy + deltaY, { steps: 6 })
  await page.waitForTimeout(40)
  await page.mouse.up()
  await page.waitForTimeout(150)
}
const state = async () =>
  page.evaluate(() => ({ model: window.__rowHeightHarness.rowHeightA(0), rect: window.__rowHeightHarness.rowRectA(0) }))

// RS01 — shrink a content-taller row BELOW its content height.
console.log('\nRS01 — shrink a row whose content is taller than the drag target')
await page.evaluate(() => window.__rowHeightHarness.mountTall())
await page.waitForTimeout(300)
const tall0 = await state()
console.log(`  content-driven height: ${Math.round(tall0.rect.height)}px`)
await dragRow0(-(Math.round(tall0.rect.height) - 30)) // aim well below content
const tall1 = await state()
console.log(`  after shrink: model=${tall1.model}px rendered=${Math.round(tall1.rect.height)}px`)
if (tall1.rect.height < tall0.rect.height - 20 && typeof tall1.model === 'number')
  ok(`row shrank below content: ${Math.round(tall0.rect.height)} -> ${Math.round(tall1.rect.height)}px`)
else
  fail(`row stuck at content height (min-height 顶住): ${Math.round(tall0.rect.height)} -> ${Math.round(tall1.rect.height)}px`)
await page.screenshot({ path: `${OUT}/rowheight-shrink.png` })

// RS02 — grow then drag back down.
console.log('\nRS02 — grow a row, then drag it back down')
await page.evaluate(() => window.__rowHeightHarness.mount())
await page.waitForTimeout(300)
await dragRow0(90)
const grown = await state()
await dragRow0(-60)
const back = await state()
console.log(`  grown=${grown.model}px  back=${back.model}px`)
if (typeof grown.model === 'number' && typeof back.model === 'number' && back.model < grown.model - 20)
  ok(`grow-then-shrink round trip: ${grown.model} -> ${back.model}px`)
else
  fail(`grow-then-shrink failed: ${grown.model} -> ${back.model}`)

// RS03 — the column-resize handle must survive on a clipped row.
console.log('\nRS03 — column resize still works on a shrunk/clipped row')
await page.evaluate(() => window.__rowHeightHarness.mountTall())
await page.waitForTimeout(300)
await dragRow0(-150) // clip hard
const cell = await page.evaluate(() => {
  const td = document.querySelector('.octo-prose table tr td')
  const b = td.getBoundingClientRect()
  return { right: b.right, midY: b.top + b.height / 2, tdH: Math.round(b.height), w: Math.round(b.width) }
})
await page.mouse.move(cell.right, cell.midY)
await page.waitForTimeout(200)
const rh = await page.evaluate(() => {
  const h = document.querySelector('.column-resize-handle')
  if (!h) return null
  const r = h.getBoundingClientRect()
  return { h: Math.round(r.height), visible: r.height > 0 && r.width > 0 }
})
if (rh && rh.visible && rh.h >= cell.tdH - 3) ok(`col-resize handle full-height on clipped row (${rh.h}px vs cell ${cell.tdH}px)`)
else fail(`col-resize handle missing/clipped on shrunk row: ${JSON.stringify(rh)} (cell ${cell.tdH}px)`)
await page.mouse.down()
await page.mouse.move(cell.right + 80, cell.midY, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const w2 = await page.evaluate(() => Math.round(document.querySelector('.octo-prose table tr td').getBoundingClientRect().width))
if (w2 > cell.w + 30) ok(`column resized on clipped row: ${cell.w} -> ${w2}px`)
else fail(`column did not resize on clipped row: ${cell.w} -> ${w2}px`)
await page.screenshot({ path: `${OUT}/rowheight-colresize-clipped.png` })

await browser.close()
if (failed) {
  console.error(`\n=== ROW-HEIGHT SHRINK HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== ROW-HEIGHT SHRINK HARNESS PASSED: rows shrink below content, grow round-trips, col-resize survives ===')
}
