// Playwright driver for the READ-ONLY PREVIEW row-height clip (SCHEMA_VERSION 19, XIN-1261 / #823 CR).
// Real Chromium, real layout: loads rowheight-preview.html (buildPreviewExtensions, editable:false,
// wrapped in .octo-prose with the real styles.css) and MEASURES the rendered <tr> height to prove a
// SHRUNK row (explicit height below its content height) stays shrunk in the read-only preview instead
// of bouncing back to content height — the CR point on #823.
//   PV01 — a row with height:30px whose content is 4 lines renders at ~30px (CLIPPED), model = 30.
//   PV02 — the SAME table with NO explicit height renders content-driven (much taller), proving PV01
//          is a real clip, not small content — the exact before/after the CR flagged.
//   PV03 — the shrunk row carries octo-row-fixed and every cell has the .octo-cell-clip wrapper (the
//          clip mechanism the CSS keys on is actually present in the preview DOM).
// Usage: node dev/run-rowheight-preview.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/rowheight-preview.html`
const OUT = 'dev/rowheight-out'
mkdirSync(OUT, { recursive: true })

let failed = 0
const fail = (m) => {
  console.error('  ✗ FAIL:', m)
  failed++
}
const ok = (m) => console.log('  ✓', m)

const SET_H = 30
const TOL = 8 // px tolerance around the set height (td padding rounding + border-box)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text())
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__previewHarness, { timeout: 30000 })

// PV02 first: measure the NATURAL (content-driven) height of the tall row as the baseline.
console.log('\nPV02 — natural (no explicit height) row is content-driven (baseline)')
await page.evaluate(() => window.__previewHarness.mountNatural())
await page.waitForTimeout(300)
const natural = await page.evaluate(() => ({
  rect: window.__previewHarness.rowRect(0),
  model: window.__previewHarness.rowModelHeight(0),
}))
const naturalH = Math.round(natural.rect.height)
console.log(`  natural rendered height: ${naturalH}px (model=${natural.model})`)
if (natural.model === null && naturalH > SET_H + 30)
  ok(`content-driven row is tall (${naturalH}px) with no height attr`)
else
  fail(`expected a tall content-driven row with null height, got ${naturalH}px model=${natural.model}`)

// PV01: the shrunk row must render at ~SET_H, clearly below the natural content height.
console.log('\nPV01 — shrunk row (height:30px) stays clipped in the read-only preview')
await page.evaluate(() => window.__previewHarness.mountShrunk())
await page.waitForTimeout(300)
const shrunk = await page.evaluate(() => ({
  rect: window.__previewHarness.rowRect(0),
  model: window.__previewHarness.rowModelHeight(0),
}))
const shrunkH = Math.round(shrunk.rect.height)
console.log(`  shrunk rendered height: ${shrunkH}px (model=${shrunk.model})`)
if (shrunk.model === SET_H && Math.abs(shrunkH - SET_H) <= TOL && shrunkH < naturalH - 30)
  ok(`row stays clipped at the set height in preview: ${shrunkH}px (set ${SET_H}px, natural was ${naturalH}px)`)
else
  fail(`row bounced back to content height in preview: rendered=${shrunkH}px set=${SET_H}px natural=${naturalH}px model=${shrunk.model}`)
await page.screenshot({ path: `${OUT}/rowheight-preview-shrunk.png` })

// PV03: the clip mechanism (class + wrapper) is actually present in the preview DOM.
console.log('\nPV03 — the preview DOM carries the clip class + .octo-cell-clip wrappers')
const struct = await page.evaluate(() => ({
  fixed: window.__previewHarness.rowHasFixedClass(0),
  clips: window.__previewHarness.cellClipCount(),
}))
console.log(`  octo-row-fixed on row 0: ${struct.fixed}; .octo-cell-clip wrappers: ${struct.clips}`)
if (struct.fixed && struct.clips >= 2) ok(`clip class + ${struct.clips} cell-clip wrappers present in preview`)
else fail(`clip mechanism missing in preview: fixed=${struct.fixed} clips=${struct.clips}`)

await browser.close()
if (failed) {
  console.error(`\n=== ROW-HEIGHT PREVIEW CLIP HARNESS FAILED (${failed}) ===`)
  process.exitCode = 1
} else {
  console.log('\n=== ROW-HEIGHT PREVIEW CLIP HARNESS PASSED: shrunk rows stay clipped in read-only preview ===')
}
