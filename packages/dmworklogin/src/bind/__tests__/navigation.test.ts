import { describe, expect, it } from 'vitest'
import { resolveBindNavigationUrl } from '../navigation'

describe('resolveBindNavigationUrl', () => {
  const shell = 'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?sid=window-sid'

  it('keeps packaged bind success on index.html instead of file:///', () => {
    expect(resolveBindNavigationUrl('/', shell)).toBe(
      'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html'
    )
  })

  it('preserves a safe return query and hash in the packaged shell', () => {
    expect(resolveBindNavigationUrl('/space?joined=1#done', shell)).toBe(
      'file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?joined=1#done'
    )
  })

  it('does not change normal web navigation', () => {
    expect(resolveBindNavigationUrl('/space', 'https://octo.example.com/oidc/bind')).toBe('/space')
  })
})
