import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub @octo/base — bindModule only touches WKApp.route.register during init.
vi.mock('@octo/base', () => {
  const routes = new Map<string, () => JSX.Element>()
  return {
    WKApp: {
      route: {
        register: (path: string, factory: () => JSX.Element) => {
          routes.set(path, factory)
        },
        get: (path: string) => routes.get(path)?.(),
      },
    },
  }
})

// Skip BindPage's real module — it pulls in @douyinfe/semi-ui → @tiptap/react,
// whose ESM package.json exports break the jsdom test loader. We only care
// about init's URL side-effects here.
vi.mock('../BindPage', () => ({
  default: () => null,
}))

async function loadModuleFresh() {
  vi.resetModules()
  const mod = await import('../bindModule')
  return mod
}

function setLocation(url: string): void {
  // jsdom lets us rewrite the URL via history.replaceState as long as the
  // origin is unchanged. Prime the origin with a jsdom-friendly base first.
  window.history.replaceState({}, '', url)
}

describe('bindModule / isBindEntry latch', () => {
  beforeEach(() => {
    setLocation('/')
  })

  it('sets the latch when pathname is /oidc/bind (web flow)', async () => {
    setLocation('/oidc/bind?token=abc&sid=window-sid')

    const { default: BindModule, isBindEntry } = await loadModuleFresh()
    new BindModule().init()

    expect(isBindEntry()).toBe(true)
  })

  it('sets the latch when __octo_route=/oidc/bind is present (packaged Electron)', async () => {
    // In packaged Electron, Chromium rejects history.replaceState() that
    // changes the path on a file:// document. Simulate the resulting state
    // where pathname stays at the shell path but __octo_route carries the
    // logical route.
    setLocation('/index.html?__octo_route=/oidc/bind&token=abc&sid=window-sid')

    const { default: BindModule, isBindEntry } = await loadModuleFresh()
    new BindModule().init()

    expect(isBindEntry()).toBe(true)
  })

  it('does not set the latch for unrelated pages', async () => {
    setLocation('/login?sid=window-sid')

    const { default: BindModule, isBindEntry } = await loadModuleFresh()
    new BindModule().init()

    expect(isBindEntry()).toBe(false)
  })

  it('scrub preserves the pathname and only strips bind-entry params', async () => {
    setLocation('/index.html?__octo_route=/oidc/bind&token=secret&provider=acme&sid=window-sid')

    const { default: BindModule } = await loadModuleFresh()
    new BindModule().init()

    // Pathname is untouched (survives file:// where path changes throw).
    expect(window.location.pathname).toBe('/index.html')
    // Bind-entry keys are gone.
    const params = new URLSearchParams(window.location.search)
    expect(params.has('__octo_route')).toBe(false)
    expect(params.has('token')).toBe(false)
    expect(params.has('provider')).toBe(false)
    // Non-bind keys (like sid) are preserved so applyLoginResp().save()
    // continues to write into the same storage bucket.
    expect(params.get('sid')).toBe('window-sid')
  })

  it('latch survives a subsequent clearBindUrl call from BindPage', async () => {
    setLocation('/oidc/bind?token=abc&sid=window-sid')

    const { default: BindModule, isBindEntry } = await loadModuleFresh()
    const { clearBindUrl } = await import('../../oidc/bind')

    new BindModule().init()
    // Simulate BindPage's on-mount scrub.
    clearBindUrl()

    expect(isBindEntry()).toBe(true)
  })

  it('resetBindEntry() clears the latch — invoked by BindPage on unmount', async () => {
    setLocation('/oidc/bind?token=abc&sid=window-sid')

    const { default: BindModule, isBindEntry, resetBindEntry } = await loadModuleFresh()
    new BindModule().init()
    expect(isBindEntry()).toBe(true)

    resetBindEntry()
    expect(isBindEntry()).toBe(false)
  })
})
