import { describe, it, expect } from 'vitest'

/**
 * Unit tests for the InviteLanding redirect basePath logic (fix for #1006).
 *
 * Reproduces the bug where `window.location.pathname === "/api/"` leads to the
 * post-join redirect landing on `https://host/api/` → 404. The fix strips any
 * `/api` or `/api/vN` prefix before treating pathname as basePath.
 *
 * Post PR#851 (sid-clean, Jerry-Xin 🟡): the redirect URL no longer carries
 * `?sid=` — the InviteLanding component now calls `setSessionSid(sid)` to
 * stash the sid in SessionScope sessionStorage and navigates to a clean URL.
 * These tests mirror that production shape.
 */

// Mirrors the private helper in apps/web/src/Components/InviteLanding/index.tsx.
// Keep this test in sync with that implementation.
function getAppBasePath(pathname: string): string {
  const p = pathname || '/'
  const stripped = p.replace(/^\/api(?:\/v\d+)?(?=\/|$)/, '')
  return stripped.replace(/\/+$/, '')
}

function buildRedirect(pathname: string): string {
  const basePath = getAppBasePath(pathname)
  return `https://host${basePath}/`
}

describe('InviteLanding redirect basePath (#1006)', () => {
  it('normal root pathname → redirects to "/"', () => {
    expect(buildRedirect('/')).toBe('https://host/')
  })

  it('"/api/" pathname no longer lands on backend 404 route', () => {
    // Bug repro: before the fix this returned "/api/" → 404.
    expect(buildRedirect('/api/')).toBe('https://host/')
  })

  it('"/api" (no trailing slash) is also stripped', () => {
    expect(buildRedirect('/api')).toBe('https://host/')
  })

  it('"/api/v1/" is stripped (versioned API path)', () => {
    expect(buildRedirect('/api/v1/')).toBe('https://host/')
  })

  it('"/api/v2/space/invite/xxx" strips the /api/vN prefix only', () => {
    // Only the /api[/vN] segment is removed — the remainder is kept so we
    // never accidentally chop off a legitimate sibling deployment path.
    expect(buildRedirect('/api/v2/space/invite/xxx')).toBe(
      'https://host/space/invite/xxx/'
    )
  })

  it('subpath deployment ("/web/") is preserved', () => {
    // Non-/api subpath must still be preserved for legacy deployments.
    expect(buildRedirect('/web/')).toBe('https://host/web/')
  })

  it('"/apiary/" is NOT stripped (only matches exact /api segment)', () => {
    // Regex uses boundary `(?=\/|$)` so /apiary is left alone.
    expect(buildRedirect('/apiary/')).toBe('https://host/apiary/')
  })
})
