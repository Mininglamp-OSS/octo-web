import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { i18n } from '@octo/base/src/i18n/instance'

// Stub @octo/base so LoginVM can be instantiated in jsdom without bringing
// in the real WKApp / apiClient. Only the surface LoginVM touches needs filling in.
vi.mock('@octo/base', () => {
  class ProviderListener {
    notifyListener = vi.fn()
  }
  const WKApp = {
    loginInfo: {
      appID: '',
      uid: '',
      token: '',
      shortNo: '',
      name: '',
      sex: 0,
      save: vi.fn(),
    },
    apiClient: {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn().mockResolvedValue({}),
    },
    endpoints: {
      callOnLogin: vi.fn(),
      onNeedJoinSpace: vi.fn(),
    },
    shared: {
      deviceId: 'd',
      deviceName: 'n',
      deviceModel: 'm',
    },
    config: {
      themeColor: '#000',
      appName: 'Test',
    },
    // providers.ts reads WKApp.remoteConfig.oidcProviders from backend /v1/common/appconfig.
    // Stub a fixed provider so LoginVM.startOidcLogin('acme-sso') works.
    remoteConfig: {
      oidcProviders: [
        {
          id: 'acme-sso',
          name: 'Acme SSO',
          authorizePath: '/v1/auth/oidc/acme-sso/authorize',
        },
      ],
    },
  }
  return {
    WKApp,
    ProviderListener,
    i18n: { setLocale: vi.fn() },
    normalizeLocale: vi.fn((value: string | null | undefined) => {
      if (value === 'zh-CN' || value === 'en-US') return value
      return undefined
    }),
  }
})

// Stub the oidc http client so no network IO happens in tests.
const fetchAuthcodeMock = vi.fn()
const pollAuthStatusMock = vi.fn()

vi.mock('../oidc', async () => {
  const actual = await vi.importActual<typeof import('../oidc')>('../oidc')
  return {
    ...actual,
    fetchAuthcode: (...args: unknown[]) => fetchAuthcodeMock(...args),
    pollAuthStatus: (...args: unknown[]) => pollAuthStatusMock(...args),
  }
})

import { LoginVM } from '../login_vm'
import {
  clearPendingOidcLogin,
  getPendingOidcLogin,
  OidcPollCancelledError,
  OidcPollNetworkError,
  OidcPollTimeoutError,
  savePendingOidcLogin,
} from '../oidc'

const ORIGINAL_LOCATION = window.location

function stubLocation() {
  // Replace window.location with a plain object so .href assignments don't
  // actually navigate jsdom (which would terminate the test).
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      origin: 'http://localhost',
      href: 'http://localhost/login',
      search: '',
    },
  })
}

function restoreLocation() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  })
}

beforeEach(() => {
  i18n.setLocale('zh-CN', { persist: false })
  sessionStorage.clear()
  fetchAuthcodeMock.mockReset()
  pollAuthStatusMock.mockReset()
  vi.useFakeTimers()
  stubLocation()
})

afterEach(() => {
  vi.useRealTimers()
  restoreLocation()
})

describe('LoginVM.startOidcLogin', () => {
  it('fetches authcode, persists pending, and redirects to authorize URL', async () => {
    fetchAuthcodeMock.mockResolvedValue('AC-123')
    const vm = new LoginVM()
    await vm.startOidcLogin('acme-sso')
    const pending = getPendingOidcLogin()
    expect(pending?.providerId).toBe('acme-sso')
    expect(pending?.authcode).toBe('AC-123')
    expect(window.location.href).toContain('/v1/auth/oidc/acme-sso/authorize')
    expect(window.location.href).toContain('authcode=AC-123')
    expect(vm.oidcLoading).toBe(true)
  })

  it('flips oidcLoading off via the fallback timer if redirect is intercepted', async () => {
    fetchAuthcodeMock.mockResolvedValue('AC-X')
    const vm = new LoginVM()
    await vm.startOidcLogin('acme-sso')
    expect(vm.oidcLoading).toBe(true)
    vi.advanceTimersByTime(LoginVM.OIDC_LOADING_RESET_MS + 1)
    expect(vm.oidcLoading).toBe(false)
  })

  it('resets oidcLoading and rethrows when fetchAuthcode fails', async () => {
    fetchAuthcodeMock.mockRejectedValue(new Error('network down'))
    const vm = new LoginVM()
    await expect(vm.startOidcLogin('acme-sso')).rejects.toThrow('network down')
    expect(vm.oidcLoading).toBe(false)
    expect(getPendingOidcLogin()).toBeNull()
  })

  it('is a no-op for unknown provider id', async () => {
    const vm = new LoginVM()
    await vm.startOidcLogin('unknown-idp')
    expect(fetchAuthcodeMock).not.toHaveBeenCalled()
    expect(vm.oidcLoading).toBe(false)
  })

  it('skips when already loading', async () => {
    fetchAuthcodeMock.mockResolvedValue('AC-1')
    const vm = new LoginVM()
    vm.oidcLoading = true
    await vm.startOidcLogin('acme-sso')
    expect(fetchAuthcodeMock).not.toHaveBeenCalled()
  })
})

describe('LoginVM.resumeOidcLoginIfPending', () => {
  it('returns handled=false when called concurrently while a resume is in-flight', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    let resolvePoll: (v: unknown) => void = () => {}
    pollAuthStatusMock.mockImplementation(
      () => new Promise((resolve) => {
        resolvePoll = resolve
      }),
    )
    const vm = new LoginVM()
    vi.spyOn(vm, 'loginSuccess').mockImplementation(() => {})
    const first = vm.resumeOidcLoginIfPending('')
    // Yield once so the first call sets oidcResuming=true.
    await Promise.resolve()
    const second = await vm.resumeOidcLoginIfPending('')
    expect(second).toEqual({ handled: false })
    // pollAuthStatus should only have been called once.
    expect(pollAuthStatusMock).toHaveBeenCalledTimes(1)
    resolvePoll({ status: 1, result: { uid: 'u', token: 't' } })
    await first
  })

  it('returns handled=false when no pending session exists', async () => {
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('')
    expect(result).toEqual({ handled: false })
    expect(pollAuthStatusMock).not.toHaveBeenCalled()
  })

  it('clears pending and reports failure when ?oidc_error=1 with matching pending', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('?oidc_error=1')
    expect(result.handled).toBe(true)
    expect(result.success).toBe(false)
    expect(getPendingOidcLogin()).toBeNull()
  })

  it('ignores ?oidc_error=1 when no pending session (anti-spoof)', async () => {
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('?oidc_error=1')
    expect(result).toEqual({ handled: false })
  })

  it('returns timeout error and clears pending when pending is past TTL', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: 1 })
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/超时/)
    expect(getPendingOidcLogin()).toBeNull()
    expect(pollAuthStatusMock).not.toHaveBeenCalled()
  })

  it('on success calls loginSuccess and reports success', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    pollAuthStatusMock.mockResolvedValue({
      status: 1,
      result: { uid: 'u1', token: 't1' },
    })
    const vm = new LoginVM()
    const loginSuccessSpy = vi.spyOn(vm, 'loginSuccess').mockImplementation(() => {})
    const result = await vm.resumeOidcLoginIfPending('')
    expect(result).toEqual({ handled: true, success: true })
    expect(loginSuccessSpy).toHaveBeenCalledWith({ uid: 'u1', token: 't1' }, 'acme-sso')
    expect(getPendingOidcLogin()).toBeNull()
    expect(vm.oidcResuming).toBe(false)
  })

  it('exposes provider name on the VM during resume', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    let nameSeenDuringPoll: string | undefined
    pollAuthStatusMock.mockImplementation(async () => {
      nameSeenDuringPoll = vm.oidcResumingProviderName
      return { status: 1, result: { uid: 'u', token: 't' } }
    })
    const vm = new LoginVM()
    vi.spyOn(vm, 'loginSuccess').mockImplementation(() => {})
    await vm.resumeOidcLoginIfPending('')
    expect(nameSeenDuringPoll).toBe('Acme SSO')
    expect(vm.oidcResumingProviderName).toBeUndefined()
  })

  it('returns failure with msg when poll resolves to status=2', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    pollAuthStatusMock.mockResolvedValue({ status: 2, msg: 'IdP rejected' })
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('IdP rejected')
  })

  it.each([
    [new OidcPollTimeoutError(), /超时/],
    [new OidcPollCancelledError(), /取消/],
    [new OidcPollNetworkError(new Error('x')), /网络异常/],
    [new Error('boom'), /登录失败/],
  ])('maps poll error %p to user-facing message', async (err, pattern) => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    pollAuthStatusMock.mockRejectedValue(err)
    const vm = new LoginVM()
    const result = await vm.resumeOidcLoginIfPending('')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(pattern)
    expect(getPendingOidcLogin()).toBeNull()
  })
})

describe('LoginVM.cancelOidcLogin', () => {
  it('clears pending up front so a refresh during sleep does not resume', () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    const vm = new LoginVM()
    vm.cancelOidcLogin()
    expect(getPendingOidcLogin()).toBeNull()
  })

  it('aborts the in-flight signal so cancel is felt immediately', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    let capturedSignal: AbortSignal | undefined
    pollAuthStatusMock.mockImplementation(async (opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal
      // Simulate a long poll that resolves only after abort.
      return await new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(new OidcPollCancelledError()),
        )
      })
    })
    const vm = new LoginVM()
    const promise = vm.resumeOidcLoginIfPending('')
    // Yield once so resumeOidcLoginIfPending wires up the AbortController.
    await Promise.resolve()
    vm.cancelOidcLogin()
    const result = await promise
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.error).toMatch(/取消/)
  })
})

// Defensive: clearPendingOidcLogin export is used directly by some flows.
describe('integration: clear after cancel', () => {
  it('cancel + later refresh yields handled=false', async () => {
    savePendingOidcLogin({ providerId: 'acme-sso', authcode: 'AC', savedAt: Date.now() })
    const vm = new LoginVM()
    vm.cancelOidcLogin()
    const fresh = new LoginVM()
    const result = await fresh.resumeOidcLoginIfPending('')
    expect(result.handled).toBe(false)
  })

  it('clearPendingOidcLogin is idempotent', () => {
    clearPendingOidcLogin()
    clearPendingOidcLogin()
    expect(getPendingOidcLogin()).toBeNull()
  })
})

describe('LoginVM.loginType setter', () => {
  it('resets loginAttemptFailed when switching login views', async () => {
    const { LoginType } = await import('../login_vm')
    const vm = new LoginVM()
    vm.loginAttemptFailed = true
    vm.loginType = LoginType.forgetPassword
    expect(vm.loginAttemptFailed).toBe(false)
  })
})
