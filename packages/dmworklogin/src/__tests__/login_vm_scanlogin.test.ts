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
    // Mirrors @octo/base's extractErrorCode (Service/APIClient.ts): reads the
    // interceptor's reject shape { code, msg, ... }. Stubbed because the real
    // module graph is mocked out wholesale here.
    extractErrorCode: (err: unknown) =>
      err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined,
    // Mirrors @octo/base's extractErrorMsg (Service/APIClient.ts).
    extractErrorMsg: (err: unknown) =>
      err && typeof err === 'object' && 'msg' in err && typeof (err as { msg: unknown }).msg === 'string'
        ? (err as { msg: string }).msg
        : '',
    normalizeLocale: vi.fn(() => undefined),
  }
})

import { WKApp } from '@octo/base'
import { LoginVM, LoginStatus, LoginType } from '../login_vm'

/** Put the VM in QR mode without letting didMount kick off real polling. */
function newQRCodeVM(): LoginVM {
  const vm = new LoginVM()
  // Assign the backing field directly — the `loginType` setter calls
  // reStartAdvance(), which would immediately fire requestUUID().
  ;(vm as unknown as { _loginType: LoginType })._loginType = LoginType.qrcode
  return vm
}

// A request that never settles.
//
// There is no longer such a thing as an "inert" status: advance() has a default arm,
// so any payload the machine does not recognise now re-mints instead of standing
// still (that silent stand-still was the frozen-page bug). When a test only cares
// about what went out on the wire, hang the request instead of resolving it — and
// nothing keeps firing across test boundaries either.
function pending(): Promise<never> {
  return new Promise(() => {})
}

/**
 * Route the mocked GET by path.
 *
 * One blanket `mockResolvedValue` cannot serve this flow any more: a mint-shaped
 * `{uuid, poll_secret, qrcode}` would also answer the follow-up status poll, where it
 * carries no `status` — and advance()'s default arm now (correctly) treats an
 * unrecognised status as "re-mint" instead of standing still. Answering each endpoint
 * with its own shape keeps the tests about the behaviour under test.
 *
 * `mint`/`poll` default to a request that never settles. `mint` may be a function to
 * vary per call.
 */
function routeGet(opts: { mint?: unknown; poll?: unknown }) {
  apiGet.mockImplementation((url: string) => {
    const target = String(url)
    if (target.includes('user/loginuuid')) {
      const mint = typeof opts.mint === 'function' ? (opts.mint as () => unknown)() : opts.mint
      return mint === undefined ? pending() : Promise.resolve(mint)
    }
    if (target.includes('user/loginstatus')) {
      return opts.poll === undefined ? pending() : Promise.resolve(opts.poll)
    }
    return Promise.resolve({})
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  apiGet.mockReset()
  apiPost.mockReset()
  // Shared singletons in the @octo/base stub: a token or a call count left behind
  // would make the post-login-throw tests read each other's state.
  WKApp.loginInfo.token = ''
  ;(WKApp.endpoints.callOnLogin as unknown as { mockClear(): void }).mockClear()
})

describe('scan-login poll credential', () => {
  it('sends poll_secret on the status poll', async () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(pending())
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
    apiGet.mockReturnValue(pending())
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
    apiGet.mockReturnValue(pending())
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
    const [path, body, config] = apiPost.mock.calls[0] as [string, unknown, { param: Record<string, unknown> }]
    expect(path).toBe('user/login_authcode/code-1')
    expect(body).toBeUndefined()
    expect(config.param).toEqual({ poll_secret: 'secret-1', flag: 1 })
    // No re-mint: a successful redemption must not restart the scan flow.
    expect(getUrls()).not.toContain('user/loginuuid')
  })

  it('url-encodes the auth code in the path and leaves the secret to axios', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue({ uid: 'u1', token: 't1' })
    apiGet.mockResolvedValue([{ space_id: 's1' }])
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'x y&z'

    await vm.requestLogin('a b&c')

    const [path, , config] = apiPost.mock.calls[0] as [string, unknown, { param: Record<string, unknown> }]
    // The code is a path segment, so it must be encoded here; the secret rides in
    // params, where axios owns serialisation (double-encoding it would break it).
    expect(path).toBe('user/login_authcode/a%20b%26c')
    expect(config.param.poll_secret).toBe('x y&z')
  })

  it('recovers instead of freezing when another login holds loginLoading', async () => {
    const vm = newQRCodeVM()
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vm.loginLoading = true // e.g. a password login is still in flight
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await vm.requestLogin('code-1')

    // Returning silently would strand an auth code the phone has already
    // confirmed: the authed branch schedules no further poll, so the page would
    // sit on the QR forever while the phone says "authorized".
    expect(apiPost).not.toHaveBeenCalled()
    expect(getUrls()).toContain('user/loginuuid')
  })

  it('carries on without re-minting when post-login handling throws after the token landed', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue({ uid: 'u1', token: 't1' })
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The token is applied, then something later blows up — blocked DOM storage in
    // an embedded build, or the space pre-flight.
    vi.spyOn(vm, 'loginSuccess').mockImplementation(() => {
      WKApp.loginInfo.token = 't1'
      throw new Error('boom')
    })

    await vm.requestLogin('code-1')

    // Re-minting here would turn a logged-in session into a half-logged-in one, so
    // the flow must go forward, not back.
    expect(getUrls()).not.toContain('user/loginuuid')
    expect(WKApp.endpoints.callOnLogin).toHaveBeenCalled()
  })

  it('restarts when post-login handling throws before the token landed', async () => {
    const vm = newQRCodeVM()
    apiPost.mockResolvedValue({ uid: 'u1', token: 't1' })
    apiGet.mockResolvedValue({ uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // applyLoginResp rejects a payload missing uid/token: no login happened at all.
    vi.spyOn(vm, 'loginSuccess').mockImplementation(() => { throw new Error('invalid login response') })

    await vm.requestLogin('code-1')

    // Nothing was applied and the old code is spent, so a fresh scan is the only
    // way out — leaving the page on a live-looking QR with polling stopped is the
    // frozen-page shape this work exists to remove.
    expect(getUrls()).toContain('user/loginuuid')
    expect(WKApp.endpoints.callOnLogin).not.toHaveBeenCalled()
  })

  it('does not spend the auth code when there is no poll_secret', async () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(pending())
    vm.uuid = 'uuid-1'
    vm.pollSecret = undefined
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await vm.requestLogin('code-1')

    // The request could only ever come back as auth_code_not_found — the server
    // checks poll_secret before consuming the code (api.go:2407 vs :2413), so this
    // is about skipping a guaranteed-404 round trip and getting to a recoverable
    // state, not about saving the code from being burnt.
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
    apiGet.mockReturnValue(pending())
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

describe('unhandled status', () => {
  it.each([
    ['a status the machine has no case for', { status: 'someFutureStatus' }],
    ['a payload with no status at all', { app_id: 'wukongchat' }],
  ])('recovers from %s instead of freezing, and does not storm', async (_label, poll) => {
    const vm = newQRCodeVM()
    routeGet({ mint: { uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' }, poll })
    vm.expireMaxTryCount = 2 // keep the bounded loop short
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    vm.pullLoginStatus('uuid-1')

    // Two properties at once. Without a default arm the status matches nothing, the
    // poll chain stops, and login.tsx keeps rendering a live QR with autoRefresh
    // still true — no error, no refresh affordance, only a page reload recovers.
    // With one, recovery must also stay bounded rather than minting forever.
    await vi.waitFor(() => expect(vm.autoRefresh).toBe(false))
    expect(vm.loginStatus).toBe(LoginStatus.expired)
    const mints = getUrls().filter((u) => u.includes('user/loginuuid')).length
    expect(mints).toBeGreaterThan(0)
    expect(mints).toBeLessThanOrEqual(vm.expireMaxTryCount + 1)
  })
})

describe('scanned confirmation window', () => {
  it('keeps polling on first entry and arms a local deadline', async () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(pending())
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
    apiGet.mockReturnValue(pending())
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

describe('restart over an unsettled mint', () => {
  it('can still mint while an abandoned mint is in flight', async () => {
    const vm = newQRCodeVM()
    let resolveFirst: (v: unknown) => void = () => {}
    let mints = 0
    // First mint hangs, the recovery mint resolves; the status poll never answers with
    // a mint payload.
    routeGet({
      mint: () => (++mints === 1
        ? new Promise((res) => { resolveFirst = res })
        : { uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' }),
    })
    vm.requestUUID()
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(vm.qrcodeLoading).toBe(true)
    const callsBefore = apiGet.mock.calls.length
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Something abandons the session while that first mint is still open.
    vm.loginStatus = LoginStatus.authed
    vm.advance({ status: LoginStatus.authed })

    // requestUUID opens with `if (this.qrcodeLoading) return`, and the abandoned
    // mint bails at its session guard *before* clearing that flag — so unless
    // abandoning hands the flag back, this recovery mint is swallowed and the panel
    // is wedged on a spinner with no QR that not even "click to refresh" can clear.
    expect(apiGet.mock.calls.length).toBe(callsBefore + 1)
    await vi.waitFor(() => expect(vm.uuid).toBe('uuid-2'))
    expect(vm.qrcodeLoading).toBe(false)

    // The abandoned mint lands late: it must not install its uuid or touch the flag
    // now owned by the session that replaced it.
    resolveFirst({ uuid: 'uuid-stale', poll_secret: 'secret-stale', qrcode: 'qr-stale' })
    await Promise.resolve()
    await Promise.resolve()
    expect(vm.uuid).toBe('uuid-2')
    expect(vm.pollSecret).toBe('secret-2')
  })
})

describe('confirmation deadline lifetime', () => {
  it('does not carry a stale deadline into a naturally re-minted QR', async () => {
    const vm = newQRCodeVM()
    routeGet({ mint: { uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' } })
    vm.uuid = 'uuid-1'
    vm.pollSecret = 'secret-1'

    // A scan that is never confirmed arms the local deadline...
    vm.loginStatus = LoginStatus.scanned
    vm.advance({ status: LoginStatus.scanned })
    ;(vm as unknown as { _scannedDeadline?: number })._scannedDeadline = Date.now() - 1

    // ...then the server's QR TTL expires first, and advance() re-mints straight
    // through getUUID — a path that never touches resetQRCodeState.
    vm.loginStatus = LoginStatus.expired
    vm.advance({ status: LoginStatus.expired })
    await vi.waitFor(() => expect(vm.uuid).toBe('uuid-2'))
    expect((vm as unknown as { _scannedDeadline?: number })._scannedDeadline).toBeUndefined()

    // The user scans the brand-new QR: it must not be judged against the old window.
    const before = apiGet.mock.calls.length
    vm.loginStatus = LoginStatus.scanned
    vm.advance({ status: LoginStatus.scanned })
    await vi.waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(before))
    const after = getUrls().slice(before)
    expect(after).not.toContain('user/loginuuid')
    expect(after[0]).toContain('user/loginstatus')
  })
})

describe('abandoned-session cap', () => {
  it('does not spend the budget on ordinary QR expiry', async () => {
    const vm = newQRCodeVM()
    routeGet({ mint: { uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' } })
    vm.expireMaxTryCount = 2

    // A user idling on the QR panel burns one natural expiry per minute (60s TTL).
    for (let i = 0; i < 2; i++) {
      vm.loginStatus = LoginStatus.expired
      vm.advance({ status: LoginStatus.expired })
      await vi.waitFor(() => expect(vm.uuid).toBe('uuid-2'))
    }

    // Their first real failure must still get a fresh QR, not a dead-end overlay:
    // idling and abandoning are different failure classes with separate budgets.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vm.loginStatus = LoginStatus.authed
    vm.advance({ status: LoginStatus.authed })
    expect(vm.autoRefresh).toBe(true)
    expect(vm.loginStatus).toBe(LoginStatus.getUUID)
  })

  it('gives a manual refresh a fresh budget', () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(pending())
    vm.expireMaxTryCount = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vm.loginStatus = LoginStatus.authed
    vm.advance({ status: LoginStatus.authed })
    expect(vm.autoRefresh).toBe(false)

    // Clicking "QR expired, click to refresh" is an explicit ask for a new start.
    vm.reStartAdvance()
    expect(vm.autoRefresh).toBe(true)
    expect(getUrls()).toContain('user/loginuuid')
  })

  it('surfaces the refresh affordance instead of re-minting forever', () => {
    const vm = newQRCodeVM()
    apiGet.mockReturnValue(pending())
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
    apiGet.mockReturnValue(pending())
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
    let mints = 0
    routeGet({
      mint: () => (++mints === 1
        ? new Promise((res) => { resolveFirst = res })
        : { uuid: 'uuid-2', poll_secret: 'secret-2', qrcode: 'qr-2' }),
    })

    vm.requestUUID()
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    // A manual refresh discards the pending session and mints again.
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
