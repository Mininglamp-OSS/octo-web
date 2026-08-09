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

/** URLs the VM asked for, in order — apiGet serves loginuuid, loginstatus and space/my. */
function getUrls(): string[] {
  return apiGet.mock.calls.map((call) => String(call[0]))
}

const SCAN_LOGIN_DISABLED = 'err.server.user.scan_login_disabled'

describe('auth_code redemption', () => {
  it('sends poll_secret and the device flag', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue({ uid: 'u1', token: 't1' })
    apiGet.mockResolvedValue([{ space_id: 's1' }]) // space/my after loginSuccess
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'

    await vm.requestLogin('code-1')

    // Without poll_secret the server rejects with err.server.user.auth_code_not_found
    // and burns the scan — the whole flow is dead on arrival once the deployment
    // switch is flipped on.
    const url = String(apiPost.mock.calls[0][0])
    expect(url).toContain('user/login_authcode/code-1')
    expect(url).toContain('poll_secret=secret-1')
    expect(url).toContain('flag=1')
    // No re-mint: a successful redemption must not restart the scan flow.
    expect(getUrls()).not.toContain('user/loginuuid')
  })

  it('url-encodes the auth code and the secret', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue({ uid: 'u1', token: 't1' })
    apiGet.mockResolvedValue([{ space_id: 's1' }])
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'x y&z'

    await vm.requestLogin('a b&c')

    const url = String(apiPost.mock.calls[0][0])
    expect(url).toContain('user/login_authcode/a%20b%26c')
    expect(url).toContain('poll_secret=x%20y%26z')
  })

  it('does not spend the auth code when there is no poll_secret', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = undefined
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await vm.requestLogin('code-1')

    // The request could only ever come back as auth_code_not_found, and it would
    // consume the scan on the way — re-mint instead of burning it.
    expect(apiPost).not.toHaveBeenCalled()
    expect(getUrls()).toContain('user/loginuuid')
  })

  it('restarts the whole flow on a failed redemption instead of retrying the code', async () => {
    const vm = newQRCodeVM()
    apiPost.mockRejectedValue({ code: 'err.server.user.auth_code_not_found', msg: 'not found' })
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.qrcode = 'qr-1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await vm.requestLogin('code-1')

    // An auth code is single-use server-side: retrying it can only fail again, and
    // stopping here leaves the page frozen while the phone says "authorized".
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(getUrls()).toContain('user/loginuuid')
    expect(vm.loginLoading).toBe(false)
  })

  it('restarts when the redemption result is unknown (empty 2xx body)', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue(undefined)
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await vm.requestLogin('code-1')

    // The server may already have issued a token; the code is consumed either way,
    // so the only correct move is a fresh scan.
    expect(getUrls()).toContain('user/loginuuid')
  })

  it('stops for good when redemption reports the feature is disabled', async () => {
    const vm = newQRCodeVM()
    apiPost.mockRejectedValue({ code: SCAN_LOGIN_DISABLED, msg: 'disabled' })
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'

    await vm.requestLogin('code-1')

    expect(vm.scanLoginDisabled).toBe(true)
    // Re-minting would just hit the same closed gate.
    expect(getUrls()).not.toContain('user/loginuuid')
  })
})

describe('disabled deployment switch', () => {
  it('handles status=disabled from the poll: stops, clears, hands back another method', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue({ status: LoginStatus.disabled })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.qrcode = 'qr-1'

    vm.pullLoginStatus('uuid-1')
    await vi.waitFor(() => expect(vm.scanLoginDisabled).toBe(true))

    // Before this branch existed, 'disabled' matched no case in advance(): polling
    // just stopped while login.tsx kept rendering the QR forever.
    expect(vm.uuid).toBeUndefined()
    expect(vm.pollSecret).toBeUndefined()
    expect(vm.qrcode).toBeUndefined()
    expect(vm.autoRefresh).toBe(false)
    expect(vm.loginType).toBe(LoginType.phone)
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('treats scan_login_disabled from loginuuid as disabled, not as an expired QR', async () => {
    const vm = newQRCodeVM()
    apiGet.mockRejectedValue({ code: SCAN_LOGIN_DISABLED, msg: 'disabled' })

    vm.requestUUID()
    await vi.waitFor(() => expect(vm.scanLoginDisabled).toBe(true))

    // The "QR expired, click to refresh" overlay would invite the user into a
    // hand-cranked loop: every click mints again and gets the same rejection.
    expect(vm.qrcodeLoading).toBe(false)
    expect(vm.loginType).toBe(LoginType.phone)
    expect(vm.qrcode).toBeUndefined()
  })
})

describe('scanned confirmation window', () => {
  it('keeps polling on first entry and arms a local deadline', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.loginStatus = LoginStatus.scanned

    vm.advance({ status: LoginStatus.scanned })
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    expect(getUrls()[0]).toContain('user/loginstatus')
    expect(
      (vm as unknown as { _scannedDeadline?: number })._scannedDeadline
    ).toBeTypeOf('number')
  })

  it('re-mints once the confirmation window has passed', () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.loginStatus = LoginStatus.scanned
    ;(vm as unknown as { _scannedDeadline?: number })._scannedDeadline = Date.now() - 1

    vm.advance({ status: LoginStatus.scanned })

    // Backstop for the case where the server-side expiry never reaches us (gateway
    // eating the long poll, status not advancing) — otherwise the page sits on
    // "scanned, waiting for phone" indefinitely.
    expect(getUrls()).toContain('user/loginuuid')
  })

  it('advances on a scanned payload that carries no uid', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.loginStatus = LoginStatus.scanned

    // The server stopped sending uid in the scanned payload (app_id/status only).
    vm.advance({ status: LoginStatus.scanned })
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    expect(vm.uid).toBeUndefined()
    expect(vm.showAvatar()).toBeFalsy()
    expect(getUrls()[0]).toContain('user/loginstatus')
  })
})

describe('abandoned-session cap', () => {
  it('surfaces the refresh affordance instead of re-minting forever', () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue(INERT)
    vm.expireMaxTryCount = 0
    vm.loginStatus = LoginStatus.authed
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    vm.advance({ status: LoginStatus.authed })

    // A systematically stripped poll_secret would otherwise loop mint → scan →
    // authed-without-code → mint, indistinguishable from ordinary expiry in logs.
    expect(vm.autoRefresh).toBe(false)
    expect(vm.loginStatus).toBe(LoginStatus.expired)
    expect(getUrls()).not.toContain('user/loginuuid')
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
