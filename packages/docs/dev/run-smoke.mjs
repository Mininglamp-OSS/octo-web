// Playwright driver for the XIN-87 collab smoke (real Chromium + real Excalidraw).
// Usage: node dev/run-smoke.mjs   (expects the standalone dev server on :4178)
import { chromium } from '@playwright/test'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/smoke.html`
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
// Wait until all four initial Excalidraw canvases (A, B-fix, B-raw, Recon) have mounted.
await page.waitForFunction(() => document.querySelectorAll('.excalidraw').length >= 4, { timeout: 30000 })
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

// 4) Cold reopen (case 7): NEW client, empty local mirror, Y.Doc synced from the server BEFORE the
//    canvas mounts. The only path to a non-empty canvas is the late setApi/setRenderAdapter replay.
await page.evaluate(() => window.__smoke.coldSyncThenMount())
await page.waitForFunction(() => document.querySelectorAll('.excalidraw').length >= 5, { timeout: 30000 })
await page.waitForTimeout(2000)
const cold = await page.evaluate(() => window.__smoke.coldScene())
console.log('Cold-reopen scene count:', cold.length)
const coldRect = cold.find((e) => e.id === 'rect-1')
const coldArrow = cold.find((e) => e.id === 'arrow-1')
if (cold.length < 2) fail(`Cold reopen expected >=2 elements, got ${cold.length} (board replayed empty)`)
if (!coldRect || coldRect.width !== 220 || coldRect.height !== 130)
  fail(`Cold reopen rectangle geometry wrong/missing: ${JSON.stringify(coldRect && { w: coldRect.width, h: coldRect.height })}`)
if (!coldRect || typeof coldRect.index !== 'string' || coldRect.index.length === 0)
  fail(`Cold reopen element not restored (missing fractional index): ${JSON.stringify(coldRect && coldRect.index)}`)
if (!coldArrow || !Array.isArray(coldArrow.points) || coldArrow.points.length < 2)
  fail(`Cold reopen arrow points missing: ${JSON.stringify(coldArrow && coldArrow.points)}`)
console.log('Cold-reopen rect:', coldRect && { w: coldRect.width, h: coldRect.height, index: coldRect.index })
await page.screenshot({ path: `${OUT}/04-cold-reopen.png`, fullPage: true })

// 5) Reconnect (case 6): Recon is synced + rendered, the WS drops, A keeps editing (move rect +
//    add an ellipse), then Recon reconnects and the buffered diff replays. It must converge.
const reconBefore = await page.evaluate(() => window.__smoke.reconScene())
console.log('Recon scene count before disconnect:', reconBefore.length)
if (reconBefore.length < 2) fail(`Recon expected >=2 elements while connected, got ${reconBefore.length}`)
await page.evaluate(() => window.__smoke.reconDisconnect())
await page.evaluate(() => window.__smoke.editWhileReconOffline())
await page.waitForTimeout(800)
const reconDuring = await page.evaluate(() => window.__smoke.reconScene())
console.log('Recon scene count while offline (should be stale):', reconDuring.length)
await page.evaluate(() => window.__smoke.reconReconnect())
await page.waitForTimeout(1500)
const reconAfter = await page.evaluate(() => window.__smoke.reconScene())
const reconRect = reconAfter.find((e) => e.id === 'rect-1')
const reconEllipse = reconAfter.find((e) => e.id === 'ellipse-1')
console.log('Recon scene count after reconnect:', reconAfter.length, '| rect at', reconRect && { x: reconRect.x, y: reconRect.y, v: reconRect.version })
if (!reconEllipse) fail(`Reconnect did not converge: new element 'ellipse-1' missing after re-sync`)
if (!reconRect || reconRect.x !== 320 || reconRect.y !== 240)
  fail(`Reconnect did not converge: rect not moved to (320,240): ${JSON.stringify(reconRect && { x: reconRect.x, y: reconRect.y, v: reconRect.version })}`)
await page.screenshot({ path: `${OUT}/05-reconnect.png`, fullPage: true })

await browser.close()
if (process.exitCode) console.error('\n=== SMOKE FAILED ===')
else console.log('\n=== SMOKE PASSED: live + incremental + reopen + cold-reopen + reconnect all converge ===')
