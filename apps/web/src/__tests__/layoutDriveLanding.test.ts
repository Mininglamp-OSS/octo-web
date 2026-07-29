/**
 * PR#1146 N2 (corrected) — the drive share/invite landing pages are intercepted by the host
 * Layout (apps/web) as standalone pages that BOTH require a valid Octo session: any signed-in
 * Octo user may open a share (they need not belong to the file's Space), but an anonymous /
 * external visitor is sent to login first and bounced back to the exact landing after sign-in.
 * Mirrors the standalone `/d/:docId` interception (recover session → render when signed in,
 * else stash the return target and fall through to login).
 *
 * Follows the source-grep convention the Layout already uses (layoutStandaloneDocPath.test.ts):
 * the component pulls in Tauri / MainPage and can't be cheaply rendered in jsdom. The
 * open-redirect-safe return allowlist for the drive shapes is covered behaviorally by
 * standaloneReturn.test.ts.
 */
import * as fs from 'fs'
import * as path from 'path'

describe('Layout — drive share/invite landing interception (PR#1146 N2, login-required)', () => {
  let layout: string

  beforeAll(() => {
    layout = fs.readFileSync(path.join(__dirname, '../Layout/index.tsx'), 'utf-8')
  })

  it('intercepts the share path and renders ShareLandingPage only when signed in', () => {
    expect(layout).toMatch(/isDriveSharePath\(\s*window\.location\.pathname\s*\)/)
    const shareBranch = layout.slice(
      layout.indexOf('isDriveSharePath('),
      layout.indexOf('isDriveInvitePath('),
    )
    // Share now requires login: recover the session, render only when authed,
    // else persist the return target and fall through to the login screen.
    expect(shareBranch).toMatch(/recoverOctoSessionFromStorage\(true\)/)
    expect(shareBranch).toMatch(/if \(WKApp\.loginInfo\.token\)/)
    expect(shareBranch).toMatch(/return <ShareLandingPage\s+token=\{shareTokenFromPath\(\)\}/)
    expect(shareBranch).toMatch(/persistStandaloneReturn\(\)/)
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
    expect(inviteBranch).toMatch(/persistStandaloneReturn\(\)/)
  })

  it('orders the share branch before the invite branch', () => {
    expect(layout.indexOf('isDriveSharePath(')).toBeLessThan(layout.indexOf('isDriveInvitePath('))
  })
})
