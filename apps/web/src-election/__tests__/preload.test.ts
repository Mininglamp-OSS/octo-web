import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture whatever the preload exposes via contextBridge.
const exposed = new Map<string, any>()

const sendMock = vi.fn()
const invokeMock = vi.fn().mockResolvedValue(undefined)
const onMock = vi.fn()
const onceMock = vi.fn()
const removeListenerMock = vi.fn()

const packagedResourcesPath = '/Applications/OCTO.app/Contents/Resources'

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed.set(key, value)
    },
  },
  ipcRenderer: {
    send: sendMock,
    invoke: invokeMock,
    on: onMock,
    once: onceMock,
    removeListener: removeListenerMock,
  },
}))

function setLocation(url: string): void {
  // jsdom disallows cross-origin history rewrites; fully replace location.
  // The preload only reads protocol/hostname, so a minimal stub is enough.
  const parsed = new URL(url)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: parsed.href,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      port: parsed.port,
      origin: parsed.origin,
    },
  })
}

function setRuntimeArgs(...args: string[]): void {
  Object.defineProperty(process, 'argv', {
    configurable: true,
    value: ['electron', 'app', ...args],
  })
}

async function loadPreloadFresh() {
  exposed.clear()
  sendMock.mockClear()
  invokeMock.mockClear()
  onMock.mockClear()
  onceMock.mockClear()
  removeListenerMock.mockClear()
  vi.resetModules()
  await import('../preload/index')
  const ipc = exposed.get('ipc') as {
    send: (channel: string, ...args: unknown[]) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
  }
  return { ipc, notif: exposed.get('electronNotification') as any }
}

describe('preload IPC origin gate', () => {
  beforeEach(() => {
    // Silence intentional warn output.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('allows ipc.send from packaged file:// shell', async () => {
    setRuntimeArgs('--octo-dev=false', `--octo-shell-path=${packagedResourcesPath}/app.asar/build/index.html`)
    setLocation('file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html')
    const { ipc } = await loadPreloadFresh()

    ipc.send('oidc-authorize-start', 'https://api.example.com/v1/')

    expect(sendMock).toHaveBeenCalledWith('oidc-authorize-start', 'https://api.example.com/v1/')
  })

  it('allows ipc.send from dev localhost shell', async () => {
    setRuntimeArgs('--octo-dev=true', '--octo-shell-path=')
    setLocation('http://localhost:3000/')
    const { ipc } = await loadPreloadFresh()

    ipc.send('restart-app')

    expect(sendMock).toHaveBeenCalledWith('restart-app')
  })

  it('blocks ipc.send from a third-party IdP origin', async () => {
    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('https://idp.example.com/authorize?client_id=octo')
    const { ipc } = await loadPreloadFresh()

    ipc.send('oidc-authorize-start', 'https://attacker.example.com/')
    ipc.send('restart-app')
    ipc.send('update-app')
    ipc.send('screenshots-start')

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('blocks ipc.invoke from a third-party IdP origin', async () => {
    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('https://idp.example.com/authorize')
    const { ipc } = await loadPreloadFresh()

    await expect(ipc.invoke('is-window-focused')).rejects.toThrow(/not allowed from this origin/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('blocks ipc.on subscription from a third-party origin', async () => {
    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('https://idp.example.com/authorize')
    const { ipc } = await loadPreloadFresh()

    ipc.on('deep-link', () => undefined)
    ipc.once('deep-link', () => undefined)

    expect(onMock).not.toHaveBeenCalled()
    expect(onceMock).not.toHaveBeenCalled()
  })

  it('blocks electronNotification invocations from a third-party origin', async () => {
    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('https://idp.example.com/authorize')
    const { notif } = await loadPreloadFresh()

    await expect(notif.show({ title: 'x' })).rejects.toThrow(/not allowed from this origin/)
    await expect(notif.closeAll()).rejects.toThrow(/not allowed from this origin/)
    await expect(notif.isWindowFocused()).rejects.toThrow(/not allowed from this origin/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('blocks an arbitrary local file even though it uses file://', async () => {
    setRuntimeArgs('--octo-dev=false', `--octo-shell-path=${packagedResourcesPath}/app.asar/build/index.html`)
    setLocation('file:///tmp/attacker.html')
    const { ipc } = await loadPreloadFresh()

    ipc.send('restart-app')

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('blocks a non-configured localhost port', async () => {
    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('http://localhost:4173/')
    const { ipc } = await loadPreloadFresh()

    ipc.send('restart-app')

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('exposes __POWERED_ELECTRON__ only on trusted shell origins', async () => {
    setRuntimeArgs('--octo-dev=false', `--octo-shell-path=${packagedResourcesPath}/app.asar/build/index.html`)
    setLocation('file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html')
    await loadPreloadFresh()
    expect(exposed.get('__POWERED_ELECTRON__')).toBe(true)

    setRuntimeArgs('--octo-dev=false', '--octo-shell-path=')
    setLocation('https://im.deepminer.com.cn/login')
    await loadPreloadFresh()
    // Remote octo-web bundle served by the API host must NOT see the flag,
    // otherwise its isDesktopRuntime check flips true and resolveApiURL throws
    // because VITE_API_URL is not inlined into the web build.
    expect(exposed.has('__POWERED_ELECTRON__')).toBe(false)
  })
})
