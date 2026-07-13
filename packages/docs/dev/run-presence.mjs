// Playwright driver for the XIN-115 presence real-browser smoke (real Chrome + real Excalidraw).
// Usage: node dev/run-presence.mjs   (expects the standalone dev server on :4178)
//
// Proves what node can't: presence renders on the real canvas. Before the fix the `collaborators`
// prop was inert (Excalidraw 0.18.1) so the remote cursor + online UserList never appeared even
// though the awareness data was correct; the fix pushes the map via api.updateScene({ collaborators }).
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PORT = process.env.HARNESS_PORT || '4178'
const URL = `http://localhost:${PORT}/presence.html`
const OUT = 'dev/presence-out'
mkdirSync(OUT, { recursive: true })

const log = (...a) => console.log(...a)
const fail = (m) => {
  console.error('PRESENCE SMOKE FAIL:', m)
  process.exitCode = 1
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => log('[pageerror]', e.message))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelectorAll('.excalidraw').length >= 2, { timeout: 45000 })
await page.waitForTimeout(1500)

const userList = (panel) => page.evaluate((p) => document.querySelectorAll(`[data-panel="${p}"] [class*="UserList"]`).length, panel)

// Phase 1 — identity only, NO pointer movement: each peer must see the other ONLINE on connect.
const deltaB1 = await page.evaluate(() => window.__presence.deltaB())
const bOnline = await userList('B')
log(`Phase1 identity-only: presence_delta(B)=${deltaB1}, B online-avatar nodes=${bOnline}`)
if (deltaB1 < 1) fail(`B should see A at the data layer on connect, got delta=${deltaB1}`)
if (bOnline < 1) fail(`B should render the online UserList on connect (no pointer), got ${bOnline} nodes`)
await page.screenshot({ path: `${OUT}/01-identity-online.png` })

// Phase 2 — real pointer movement over A: A's remote cursor must reach B with a pointer.
const boxA = await page.locator('[data-panel="A"] .excalidraw canvas').first().boundingBox()
for (let i = 0; i < 12; i++) {
  await page.mouse.move(boxA.x + 150 + i * 22, boxA.y + 170 + i * 14, { steps: 3 })
  await page.waitForTimeout(60)
}
await page.waitForTimeout(800)
const collabB = await page.evaluate(() => window.__presence.collabB())
const hasPointer = Object.values(collabB || {}).some((c) => c.pointer)
log(`Phase2 real pointer: B collaborators=${JSON.stringify(collabB)}`)
if (!hasPointer) fail('B should receive A live pointer after A moves over the canvas')
await page.screenshot({ path: `${OUT}/02-remote-cursor.png` })

await browser.close()
if (process.exitCode) console.error('\n=== PRESENCE SMOKE FAILED ===')
else console.log('\n=== PRESENCE SMOKE PASSED: online-on-connect + live remote cursor render ===')
