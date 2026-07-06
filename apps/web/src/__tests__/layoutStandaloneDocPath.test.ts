/**
 * octo-web #512 — clean cold-load main path for the standalone doc page (`/d/:docId`).
 *
 * The tester's real-machine run (XIN-293) failed 6 ACs that all traced to the clean/direct
 * cold-load path never being self-sufficient: it only worked via the in-app sid route. These
 * guards lock the Layout wiring that makes the clean path stand on its own, following the
 * source-grep convention the Layout already uses (layoutPendingInviteToast.test.ts) since the
 * component pulls in Tauri / MainPage and can't be cheaply rendered in jsdom. Behavioral coverage
 * of the pieces lives in recoverSession.test.ts (recovery scan), the @octo/docs unit tests
 * (namespace + not-found), and the standalone-doc Playwright e2e (real browser cold-load).
 */
import * as fs from 'fs'
import * as path from 'path'

describe('Layout — standalone /d/:docId clean cold-load path', () => {
  let layout: string

  beforeAll(() => {
    layout = fs.readFileSync(path.join(__dirname, '../Layout/index.tsx'), 'utf-8')
  })

  it('claims the whole /d namespace so malformed ids are intercepted, not shelled (AC-9)', () => {
    expect(layout).toMatch(/isStandaloneDocPath\(\s*window\.location\.pathname\s*\)/)
    // The old guard keyed off a well-formed id only (`if (standaloneDocId)`); ensure we no longer
    // gate the interception on a truthy parsed id.
    expect(layout).not.toMatch(/if\s*\(\s*standaloneDocId\s*\)/)
  })

  it('recovers a stored session before rendering so a clean cold-load authenticates (AC-3)', () => {
    // Standalone persists the recovered session (Back-keeps-login), so it passes persist:true.
    expect(layout).toMatch(/recoverOctoSessionFromStorage\(true\)/)
    // Inside the namespace branch, recovery must run before the page renders. Search from the
    // branch start so the helper's top-of-file definition doesn't skew the ordering.
    const nsIdx = layout.search(/isStandaloneDocPath\(\s*window\.location\.pathname\s*\)/)
    expect(nsIdx).toBeGreaterThan(0)
    const recoverIdx = layout.indexOf('recoverOctoSessionFromStorage(true)', nsIdx)
    const renderIdx = layout.indexOf('<StandaloneDocPage', nsIdx)
    expect(recoverIdx).toBeGreaterThan(nsIdx)
    expect(renderIdx).toBeGreaterThan(recoverIdx)
  })

  it('renders the standalone page only when a token is present (else falls through to login, AC-11)', () => {
    // The page is returned inside `if (WKApp.loginInfo.token)`; an anonymous visitor falls through
    // to the Provider/login branch rendered in place (pathname stays /d/:docId → onLogin bounces
    // back after sign-in).
    expect(layout).toMatch(/if\s*\(\s*WKApp\.loginInfo\.token\s*\)\s*\{[\s\S]*?<StandaloneDocPage/)
  })

  it('shares the same recovery with the invite-landing branch (no duplicated scan loop)', () => {
    // Both deep-link branches now call the shared helper; the old inline localStorage loop in the
    // invite branch must be gone.
    expect(layout).not.toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*localStorage\.length/)
    expect(layout.match(/recoverOctoSessionFromStorage\(/g)?.length).toBeGreaterThanOrEqual(2)
    // XIN-392 P1-2: the invite branch recovers in memory only (persist:false), so it keeps its
    // original non-persistent semantics rather than pinning a session cross-tab like standalone.
    expect(layout).toMatch(/recoverOctoSessionFromStorage\(false\)/)
  })
})
