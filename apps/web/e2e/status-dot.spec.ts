import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Read the real component styles so the test tracks the source, not a copy.
// cwd is apps/web when run via `playwright test -c e2e/status-dot.config.ts`.
const loopCss = readFileSync(`${process.cwd()}/../../packages/dmloop/src/pages/loop.css`, 'utf-8')

const STATUSES = ['idle', 'working', 'offline', 'error', 'unstable', 'archived'] as const

function content(): string {
  const dots = STATUSES.map((s) => `<i class="loop-status-dot" data-status="${s}" id="dot-${s}"></i>`).join('')
  return `<style>${loopCss}</style><div style="background:#fff">${dots}</div>`
}

// Resolve a CSS color expression (e.g. a var()) to its computed rgb() via a throwaway probe,
// so we compare the SOURCE colors — not a dot's background, which for the hollow offline state
// is the page fill, with the grey living in the ring instead.
async function resolveColor(page: import('@playwright/test').Page, expr: string): Promise<string> {
  return page.evaluate((e) => {
    const p = document.createElement('div')
    p.style.background = e
    document.body.appendChild(p)
    const c = getComputedStyle(p).backgroundColor
    p.remove()
    return c
  }, expr)
}

const dotBg = (page: import('@playwright/test').Page, id: string) =>
  page.$eval(`#${id}`, (el) => getComputedStyle(el).backgroundColor)

test.describe('agent status dot (#808)', () => {
  test('online-idle color is distinct from the offline grey (guards the #808 regression)', async ({ page }) => {
    await page.setContent(content())
    const idle = await resolveColor(page, 'var(--dot-idle)')
    const offline = await resolveColor(page, 'var(--dot-offline)')
    // The reported bug was idle falling back to the offline grey. If --dot-idle is ever pointed
    // at the offline grey again, this fails — that is the whole point of the guard.
    expect(idle).not.toBe(offline)
    // The idle dot renders the idle color as a solid fill.
    expect(await dotBg(page, 'dot-idle')).toBe(idle)
    // The offline dot is hollow: its own fill is the page bg (NOT the grey), and the grey is an inset ring.
    expect(await dotBg(page, 'dot-offline')).not.toBe(offline)
    const offlineShadow = await page.$eval('#dot-offline', (el) => getComputedStyle(el).boxShadow)
    expect(offlineShadow).not.toBe('none')
  })

  test('idle / working / offline / error are four distinct colors', async ({ page }) => {
    await page.setContent(content())
    const colors = await Promise.all(
      ['--dot-idle', '--dot-working', '--dot-offline', '--dot-error'].map((v) => resolveColor(page, `var(${v})`)),
    )
    expect(new Set(colors).size).toBe(4)
  })

  test('working pulses, and stops under prefers-reduced-motion', async ({ page }) => {
    const html = `<style>${loopCss}</style><i class="loop-status-dot" data-status="working" id="w"></i>`
    const animName = () => page.$eval('#w', (el) => getComputedStyle(el).animationName)

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setContent(html)
    expect(await animName()).not.toBe('none')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setContent(html)
    expect(await animName()).toBe('none')
  })
})
