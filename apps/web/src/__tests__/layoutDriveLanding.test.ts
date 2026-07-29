/**
 * PR#1146 N2 — the drive share/invite landing pages are intercepted by the host Layout
 * (apps/web) as standalone pages: the public SHARE page renders anonymously (its endpoints
 * need no auth, so an external recipient with no octo account must reach it WITHOUT the login
 * gate), and the authenticated INVITE page mirrors the `/d/:docId` flow (recover session →
 * render when signed in, else stash the return target and fall through to login).
 *
 * Follows the source-grep convention the Layout already uses (layoutStandaloneDocPath.test.ts):
 * the component pulls in Tauri / MainPage and can't be cheaply rendered in jsdom, so these guards
 * lock the wiring. Behavioral coverage of the open-redirect-safe return lives in the @octo/docs
 * StandaloneDocPage unit tests (isSafeReturnPath drive-path cases).
 */
import * as fs from 'fs'
import * as path from 'path'

describe('Layout — drive share/invite landing interception (PR#1146 N2)', () => {
  let layout: string

  beforeAll(() => {
    layout = fs.readFileSync(path.join(__dirname, '../Layout/index.tsx'), 'utf-8')
  })

  it('intercepts the public share path and renders ShareLandingPage', () => {
    expect(layout).toMatch(/isDriveSharePath\(\s*window\.location\.pathname\s*\)/)
    expect(layout).toMatch(/<ShareLandingPage\s+token=\{shareTokenFromPath\(\)\}/)
  })

  it('renders the share page ANONYMOUSLY — no session recovery/login gate in the share branch', () => {
    // The share branch must return before any token/session check. Extract it and assert it
    // neither recovers a session nor persists a return target (both are invite-only concerns).
    const shareBranch = layout.slice(
      layout.indexOf('isDriveSharePath('),
      layout.indexOf('isDriveInvitePath('),
    )
    expect(shareBranch).toMatch(/return <ShareLandingPage/)
    expect(shareBranch).not.toMatch(/recoverOctoSessionFromStorage/)
    expect(shareBranch).not.toMatch(/persistStandaloneReturn/)
    expect(shareBranch).not.toMatch(/loginInfo\.token/)
  })

  it('intercepts the invite path, recovers the session, and renders InviteLandingPage when signed in', () => {
    expect(layout).toMatch(/isDriveInvitePath\(\s*window\.location\.pathname\s*\)/)
    const inviteBranch = layout.slice(
      layout.indexOf('isDriveInvitePath('),
      layout.indexOf('Read-only shared summary deep-link'),
    )
    expect(inviteBranch).toMatch(/recoverOctoSessionFromStorage\(true\)/)
    expect(inviteBranch).toMatch(/if \(WKApp\.loginInfo\.token\)/)
    expect(inviteBranch).toMatch(/<InviteLandingPage\s+token=\{inviteTokenFromPath\(\)\}/)
    // Anonymous invite: stash the exact target so the post-login bounce returns to the invite.
    expect(inviteBranch).toMatch(/persistStandaloneReturn\(\)/)
  })

  it('orders the share branch before the invite branch', () => {
    expect(layout.indexOf('isDriveSharePath(')).toBeLessThan(layout.indexOf('isDriveInvitePath('))
  })
})
