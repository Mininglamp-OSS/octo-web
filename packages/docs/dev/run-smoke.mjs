// Playwright driver for the XIN-87 collab smoke (real Chromium + real Excalidraw).
// Usage: node dev/run-smoke.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'

const URL = 'http://localhost:4179/smoke.html'
const OUT = 'dev/smoke-out'
const fail = (msg) => {
  console.error('SMOKE FAIL:', msg)
  process.exitCode = 1
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('failed') || m.type() === 'error') console.log('[page]', m.type(), t)
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(URL, { waitUntil: 'networkidle' })
// Wait until all three initial Excalidraw canvases have mounted.
await page.waitForFunction(() => document.querySelectorAll('.excalidraw').length >= 3, { timeout: 30000 })
await page.waitForTimeout(1500)

// 1) Author the scene on A — flows over the wire to B-fix and is pushed raw to B-raw.
await page.evaluate(() => window.__smoke.seed())
await page.waitForTimeout(1200)

const bFix = await page.evaluate(() => window.__smoke.bFixScene())
const bRaw = await page.evaluate(() => window.__smoke.bRawScene())
console.log('B-fix scene count:', bFix.length, 'B-raw scene count:', bRaw.length)

const rectFix = bFix.find((e) => e.id === 'rect-1')
const arrowFix = bFix.find((e) => e.id === 'arrow-1')
if (bFix.length < 2) fail(`B-fix expected >=2 elements, got ${bFix.length}`)
if (!rectFix || rectFix.type !== 'rectangle' || rectFix.width !== 220 || rectFix.height !== 130)
  fail(`B-fix rectangle geometry wrong: ${JSON.stringify(rectFix)}`)
if (!arrowFix || arrowFix.type !== 'arrow' || !Array.isArray(arrowFix.points) || arrowFix.points.length < 2)
  fail(`B-fix arrow points missing: ${JSON.stringify(arrowFix && arrowFix.points)}`)
// restoreElements assigns a fractional `index` (z-order) the raw element lacked — the hydration
// step whose absence rendered elements as points/handles. Its presence proves the contract ran.
if (!rectFix || typeof rectFix.index !== 'string' || rectFix.index.length === 0)
  fail(`B-fix element missing restored fractional index: ${JSON.stringify(rectFix && rectFix.index)}`)
console.log('B-fix rect.index:', rectFix && rectFix.index, '| restored shape present:', !!(rectFix && arrowFix))

await page.screenshot({ path: `${OUT}/01-live-AtoB.png` })

// 2) Incremental edit on A → B-fix updates live.
await page.evaluate(() => window.__smoke.moveRect())
await page.waitForTimeout(1000)
const bFix2 = await page.evaluate(() => window.__smoke.bFixScene())
const rectMoved = bFix2.find((e) => e.id === 'rect-1')
if (!rectMoved || rectMoved.x !== 180 || rectMoved.y !== 120)
  fail(`B-fix incremental move not applied: ${JSON.stringify(rectMoved && { x: rectMoved.x, y: rectMoved.y, v: rectMoved.version })}`)
console.log('B-fix after incremental move: rect at', rectMoved && { x: rectMoved.x, y: rectMoved.y, version: rectMoved.version })
await page.screenshot({ path: `${OUT}/02-incremental.png` })

// 3) Reopen: fresh board whose local mirror holds RAW elements → initialData restored → non-empty.
await page.evaluate(() => window.__smoke.prepareReopen())
await page.waitForTimeout(2000)
const reopen = await page.evaluate(() => window.__smoke.reopenScene())
console.log('Reopen scene count:', reopen.length)
if (reopen.length < 2) fail(`Reopen replay expected >=2 elements, got ${reopen.length}`)
const reopenRect = reopen.find((e) => e.id === 'rect-1')
if (!reopenRect || typeof reopenRect.index !== 'string')
  fail(`Reopen element not restored: ${JSON.stringify(reopenRect)}`)
await page.screenshot({ path: `${OUT}/03-reopen.png`, fullPage: true })

await browser.close()
if (process.exitCode) console.error('\n=== SMOKE FAILED ===')
else console.log('\n=== SMOKE PASSED: A→B live full render + incremental + reopen non-empty ===')
