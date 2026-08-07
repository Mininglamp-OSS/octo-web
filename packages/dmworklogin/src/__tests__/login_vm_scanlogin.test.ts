import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub @octo/base so LoginVM can be instantiated in jsdom without the real
// WKApp / apiClient. Mirrors login_vm_oidc.test.ts — only the surface LoginVM
// touches needs filling in.
const apiGet = vi.fn()
const apiPost = vi.fn()

vi.mock('@octo/base', () => {
  class ProviderListener {
    notifyListener = vi.fn()
  }
  const WKApp = {
    loginInfo: { appID: '', uid: '', token: '', shortNo: '', name: '', sex: 0, save: vi.fn() },
    apiClient: {
      config: { apiURL: '/api/v1/' },
      get: (...args: unknown[]) => apiGet(...args),
      post: (...args: unknown[]) => apiPost(...args),
    },
    endpoints: { callOnLogin: vi.fn(), onNeedJoinSpace: vi.fn() },
    shared: { deviceId: 'd', deviceName: 'n', deviceModel: 'm' },
    config: { themeColor: '#000', appName: 'Test' },
    remoteConfig: { oidcProviders: [] },
  }
  return {
    WKApp,
    ProviderListener,
    i18n: { setLocale: vi.fn() },
    normalizeLocale: vi.fn(() => undefined),
  }
})

import { LoginVM, LoginStatus, LoginType } from '../login_vm'

/** Put the VM in QR mode without letting didMount kick off real polling. */
function newQRCodeVM(): LoginVM {
  const vm = new LoginVM()
  // Assign the backing field directly — the `loginType` setter calls
  // reStartAdvance(), which would immediately fire requestUUID().
  ;(vm as unknown as { _loginType: LoginType })._loginType = LoginType.qrcode
  return vm
}

// A status the state machine has no case for. Resolving the poll with `waitScan`
// would make advance() immediately re-poll, and that chain keeps firing across
// test boundaries — which looks exactly like mock state leaking between tests.
const INERT = { status: 'inert-for-test' }

beforeEach(() => {
  vi.restoreAllMocks()
  apiGet.mockReset()
  apiPost.mockReset()
})

describe('scan-login poll credential', () => {
  it('sends poll_secret on the status poll', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'

    vm.pullLoginStatus('uuid-1')
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    const url = String(apiGet.mock.calls[0][0])
    // The credential is what gates auth_code server-side; if it stops being sent,
    // login silently stops completing rather than failing loudly.
    expect(url).toContain('poll_secret=secret-1')
    expect(url).toContain('uuid=uuid-1')
  })

  it('url-encodes uuid and poll_secret', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'a b&c'
    vm.pollSecret = 'x y&z'

    vm.pullLoginStatus('a b&c')
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    const url = String(apiGet.mock.calls[0][0])
    expect(url).toContain('uuid=a%20b%26c')
    expect(url).toContain('poll_secret=x%20y%26z')
  })

  it('omits poll_secret when there is none rather than sending "undefined"', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = undefined

    vm.pullLoginStatus('uuid-1')
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    expect(String(apiGet.mock.calls[0][0])).not.toContain('poll_secret')
  })

  it('drops an in-flight response whose uuid has been superseded', async () => {
    const vm = newQRCodeVM()
    let resolvePoll: (v: unknown) => void = () => {}
    apiGet.mockReturnValue(new Promise((res) => { resolvePoll = res }))
    vm.uuid = 'uuid-old'
    vm.pollSecret = 'secret-old'

    vm.pullLoginStatus('uuid-old')
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    // A manual refresh / login-type switch mints a new uuid while the poll is open.
    vm.uuid = 'uuid-new'
    resolvePoll({ status: LoginStatus.authed, auth_code: 'stale-code' })
    await Promise.resolve()
    await Promise.resolve()

    // The stale response must not drive the state machine — neither redeeming a
    // superseded auth_code nor discarding the QR that was just minted.
    expect(apiPost).not.toHaveBeenCalled()
    expect(vm.uuid).toBe('uuid-new')
  })
})

describe('authed without auth_code', () => {
  it('re-mints instead of redeeming undefined', () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.qrcode = 'qr-1'
    vm.loginStatus = LoginStatus.authed
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    vm.advance({ status: LoginStatus.authed })

    // POST user/login_authcode/undefined would 400, and polling has already
    // stopped by this point — the page would freeze with the phone showing
    // "authorized".
    expect(apiPost).not.toHaveBeenCalled()
    expect(vm.loginStatus).toBe(LoginStatus.getUUID)
  })

  it('clears the consumed QR state so no stale code is rendered', () => {
    const vm = newQRCodeVM()
    // Make the re-mint hang so we observe the state between transition and refill.
    apiGet.mockReturnValue(new Promise(() => {}))
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.qrcode = 'qr-1'
    vm.loginStatus = LoginStatus.authed
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    vm.advance({ status: LoginStatus.authed })

    // login.tsx renders whenever `qrcode` is truthy and not loading. Leaving the
    // consumed values in place shows a normal-looking QR for a uuid that has
    // already been authorized and can never complete.
    expect(vm.qrcode).toBeUndefined()
    expect(vm.uuid).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
  })

  it('warns so a silently-dropped poll_secret is diagnosable', () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(new Promise(() => {}))
    vm.loginStatus = LoginStatus.authed
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vm.advance({ status: LoginStatus.authed })

    // Otherwise this is indistinguishable from ordinary QR expiry in logs.
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain('auth_code')
  })
})

describe('failed re-mint', () => {
  it('surfaces the expired affordance instead of a QR that cannot complete', async () => {
    const vm = newQRCodeVM()
    apiGet.mockRejectedValue(new Error('429'))
    vm.uuid = 'uuid-1'
    vm.qrcode = 'qr-1'
    vm.pollSecret = 'secret-1'

    vm.requestUUID()
    await vi.waitFor(() => expect(vm.qrcodeLoading).toBe(false))

    // autoRefresh=false is what makes login.tsx render the existing
    // "QR expired, click to refresh" overlay — the only recovery path short of a
    // manual page reload. #715 adds rate limiting to loginuuid, so a re-mint can
    // now legitimately 429 under shared egress.
    expect(vm.autoRefresh).toBe(false)
    expect(vm.qrcode).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
  })
})

describe('credential lifetime', () => {
  it('clearSensitiveFields drops the poll secret', () => {
    const vm = newQRCodeVM()
    vm.pollSecret = 'secret-1'
    vm.clearSensitiveFields()
    expect(vm.pollSecret).toBeUndefined()
  })

  it('didUnMount stops the poll chain from resuming', () => {
    const vm = newQRCodeVM()
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'

    vm.didUnMount()

    // The poll is a promise chain plus setTimeout; clearing uuid makes the next
    // pullLoginStatus bail at its pre-flight guard instead of continuing to mutate
    // a torn-down VM and re-presenting the secret.
    expect(vm.uuid).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
    apiGet.mockResolvedValue(INERT)
    vm.pullLoginStatus('uuid-1')
    expect(apiGet).not.toHaveBeenCalled()
  })
})

describe('unmount race', () => {
  it('an in-flight requestUUID that resolves after didUnMount installs nothing', async () => {
    const vm = newQRCodeVM()
    let resolveMint: (v: unknown) => void = () => {}
    apiGet.mockReturnValue(new Promise((res) => { resolveMint = res }))

    vm.requestUUID()
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())
    const callsAfterMint = apiGet.mock.calls.length

    vm.didUnMount()
    // The mint lands after teardown. Without a session guard its `then` writes
    // uuid/pollSecret/qrcode, flips to waitScan and calls advance() — resurrecting
    // hidden polling on an unmounted VM that keeps putting the secret on the wire,
    // and could even complete scan-login off-screen.
    resolveMint({ uuid: 'uuid-late', poll_secret: 'secret-late', qrcode: 'qr-late' })
    await Promise.resolve()
    await Promise.resolve()

    expect(vm.uuid).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
    expect(vm.qrcode).toBeUndefined()
    expect(vm.loginStatus).not.toBe(LoginStatus.waitScan)
    // No follow-up poll was issued.
    expect(apiGet.mock.calls.length).toBe(callsAfterMint)
  })

  it('an in-flight requestUUID that rejects after didUnMount does not touch state', async () => {
    const vm = newQRCodeVM()
    let rejectMint: (e: unknown) => void = () => {}
    apiGet.mockReturnValue(new Promise((_res, rej) => { rejectMint = rej }))

    vm.requestUUID()
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    vm.didUnMount()
    rejectMint(new Error('network'))
    await Promise.resolve()
    await Promise.resolve()

    // The catch would otherwise flip autoRefresh on a torn-down VM, and the
    // autoRefresh setter calls reStartAdvance() — restarting the whole flow.
    expect(vm.autoRefresh).toBe(true)
    expect(vm.uuid).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
  })

  it('a superseded mint does not clobber the QR that replaced it', async () => {
    const vm = newQRCodeVM()
    let resolveFirst: (v: unknown) => void = () => {}
    apiGet.mockReturnValueOnce(new Promise((res) => { resolveFirst = res }))

    vm.requestUUID()
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    // A manual refresh discards the pending session and mints again.
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.qrcodeLoading = false
    ;(vm as unknown as { resetQRCodeState(): void }).resetQRCodeState()
    vm.requestUUID()
    await vi.waitFor(() => expect(vm.uuid).toBe('uuid-2'))

    resolveFirst({ uuid: 'uuid-1', poll_secret: 'secret-1', qrcode: 'qr-1' })
    await Promise.resolve()
    await Promise.resolve()

    expect(vm.uuid).toBe('uuid-2')
    expect(vm.pollSecret).toBe('secret-2')
  })
})
