import * as fs from 'fs'
import * as path from 'path'

/**
 * Regression for the forwarded-doc deep-link capture (feature #511, XIN-328 / XIN-332 / XIN-333).
 *
 * The forwarded-doc card link opens a new tab at `/docs?...&doc=<docId>`, but the octo host's
 * RouteManager re-pushes pathname-only on pageshow/popstate and wipes `?doc=` to `/docs?sid=…`
 * before the code-split docs chunk mounts — XIN-332 proved DocsModule.init() runs AFTER that
 * wipe on device. The fix moves the primary capture into an inline <script> at the top of
 * index.html, which runs during HTML parse (earliest synchronous entry). These tests extract that
 * inline script and execute it against jsdom so the behaviour and the observability marker cannot
 * silently regress or drift from the `octo.docs.target` key the docs module reads.
 */
describe('index.html forwarded-doc deep-link capture (XIN-333)', () => {
  const STORAGE_KEY = 'octo.docs.target'
  let inlineScript: string

  beforeAll(() => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8')
    // Grab the first inline <script> (the capture IIFE — it has no src attribute).
    const match = html.match(/<script>([\s\S]*?)<\/script>/)
    if (!match) throw new Error('inline capture <script> not found in apps/web/index.html')
    inlineScript = match[1]
  })

  beforeEach(() => {
    window.sessionStorage.clear()
    delete (window as unknown as { __OCTO_DOCS_DEEPLINK__?: unknown }).__OCTO_DOCS_DEEPLINK__
  })

  const run = (url: string) => {
    window.history.replaceState({}, '', url)
    // Execute the extracted inline script in the jsdom global scope.
    // eslint-disable-next-line no-eval
    eval(inlineScript)
  }

  const marker = () =>
    (window as unknown as { __OCTO_DOCS_DEEPLINK__?: Record<string, unknown> }).__OCTO_DOCS_DEEPLINK__

  it('stashes a /docs?doc= deep-link into the mirror the docs module reads', () => {
    run('/docs?space=s_1&folder=f_1&doc=d_forwarded')
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ doc: 'd_forwarded', space: 's_1', folder: 'f_1' })
  })

  it('accepts the ?docId= alias and omits absent space/folder (defaults applied on read)', () => {
    run('/docs?docId=d_only')
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toEqual({ doc: 'd_only' })
  })

  it('exposes an observability marker proving the capture ran (XIN-332 hard gate)', () => {
    run('/docs?doc=d_obs')
    expect(marker()).toEqual({ captured: true, doc: 'd_obs', source: 'index.html' })
  })

  it('does NOT stash on a plain /docs visit, but still records a marker', () => {
    run('/docs')
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(marker()).toEqual({ captured: false, doc: '', source: 'index.html' })
  })

  it('is inert on non-/docs routes (no stash, no marker)', () => {
    run('/chat?doc=d_should_not_capture')
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(marker()).toBeUndefined()
  })
})
