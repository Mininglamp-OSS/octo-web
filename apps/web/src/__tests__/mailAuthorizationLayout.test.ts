import * as fs from 'fs'
import * as path from 'path'

describe('Layout — Agent Mail authorization return lifecycle', () => {
  const layout = fs.readFileSync(path.join(__dirname, '../Layout/index.tsx'), 'utf-8')

  it('stashes the authorization URL once during mount, never from render', () => {
    const mountIdx = layout.indexOf('componentDidMount()')
    const renderIdx = layout.indexOf('render()')
    const persistIdx = layout.indexOf('persistStandaloneReturn()', mountIdx)
    const renderBranchIdx = layout.indexOf(
      'if (isMailAuthorizePath(window.location.pathname))',
      renderIdx,
    )
    const renderBranchEnd = layout.indexOf(
      'const enterpriseStandaloneHandlers',
      renderBranchIdx,
    )

    expect(mountIdx).toBeGreaterThan(0)
    expect(persistIdx).toBeGreaterThan(mountIdx)
    expect(persistIdx).toBeLessThan(renderIdx)
    expect(renderBranchIdx).toBeGreaterThan(renderIdx)
    expect(renderBranchEnd).toBeGreaterThan(renderBranchIdx)
    expect(layout.slice(renderBranchIdx, renderBranchEnd)).not.toContain(
      'persistStandaloneReturn()',
    )
  })

  it('clears the stashed URL only when the Mail page reports a resolved outcome', () => {
    expect(layout).toMatch(
      /addEventListener\(\s*MAIL_AUTHORIZATION_RESOLVED_EVENT,\s*this\.onMailAuthorizationResolved/
    )
    expect(layout).toMatch(
      /onMailAuthorizationResolved\s*=\s*\(\)\s*=>\s*clearStandaloneReturn\(\)/
    )
    expect(layout).toMatch(
      /removeEventListener\(\s*MAIL_AUTHORIZATION_RESOLVED_EVENT,\s*this\.onMailAuthorizationResolved/
    )
  })

  it('gives the Mail page the same expired-session recovery used by standalone pages', () => {
    expect(layout).toMatch(
      /WKApp\.route\.get\(MAIL_AUTHORIZE_PATH,\s*\{\s*onSessionExpired:\s*clearExpiredStandaloneSessionAndReload,?\s*\}\)/,
    )
  })

  it('does not run the unrelated cold-start Space request on the authorization route', () => {
    expect(layout).toMatch(
      /WKApp\.shared\.isLogined\(\)\s*&&\s*!isMailAuthorizePath\(window\.location\.pathname\)/,
    )
  })
})
