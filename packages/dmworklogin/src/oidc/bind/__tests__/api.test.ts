import { describe, it, expect, vi } from 'vitest'
import {
  fetchBindInfo,
  verifyBindPassword,
  sendBindOtp,
  checkBindOtp,
  confirmBind,
  createBind,
  FALLBACK_PROVIDER_ID,
} from '../api'
import type { OidcHttpClient } from '../../api'

function makeClient(overrides: Partial<OidcHttpClient> = {}): OidcHttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  }
}

describe('fetchBindInfo', () => {
  it('GETs /v1/auth/oidc/<provider>/bind/info?token=', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@example.com',
      masked_phone: '****5678',
      name: 'Alice',
      methods: ['password', 'sms_otp'],
      support_contact: 's@x.com',
    })
    const client = makeClient({ get })
    const info = await fetchBindInfo(client, 'tok', { provider: 'aegis' })
    expect(get).toHaveBeenCalledWith(
      '/v1/auth/oidc/aegis/bind/info?token=tok',
      { signal: undefined },
    )
    expect(info).toEqual({
      masked_email: 'a***@example.com',
      masked_phone: '****5678',
      name: 'Alice',
      methods: ['password', 'sms_otp'],
      support_contact: 's@x.com',
    })
  })

  it('falls back to aegis when provider missing and fires telemetry', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: '',
      name: 'X',
      methods: ['password'],
    })
    const client = makeClient({ get })
    const onProviderFallback = vi.fn()
    await fetchBindInfo(client, 'tok', { telemetry: { onProviderFallback } })
    expect(get.mock.calls[0][0]).toContain(`/v1/auth/oidc/${FALLBACK_PROVIDER_ID}/bind/`)
    expect(onProviderFallback).toHaveBeenCalledWith('missing')
  })

  it('flags invalid provider via telemetry and still falls back', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: '',
      name: 'X',
      methods: [],
    })
    const onProviderFallback = vi.fn()
    await fetchBindInfo(makeClient({ get }), 'tok', {
      provider: '../evil',
      telemetry: { onProviderFallback },
    })
    expect(get.mock.calls[0][0]).toContain(`/v1/auth/oidc/${FALLBACK_PROVIDER_ID}/bind/`)
    expect(onProviderFallback).toHaveBeenCalledWith('invalid')
  })

  it('omits masked_phone when backend omits the field (tri-state)', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@x',
      name: 'A',
      methods: ['password'],
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info).not.toHaveProperty('masked_phone')
  })

  it('treats empty masked_phone as absent', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'e',
      masked_phone: '',
      name: 'A',
      methods: [],
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info).not.toHaveProperty('masked_phone')
  })

  it('drops unknown methods from the response', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: '',
      name: 'A',
      methods: ['password', 'face_id', 'sms_otp', 42],
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info.methods).toEqual(['password', 'sms_otp'])
  })

  it('rejects malformed response', async () => {
    const get = vi.fn().mockResolvedValue(null)
    await expect(
      fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })

  it('rejects when methods is not an array', async () => {
    const get = vi.fn().mockResolvedValue({ masked_email: '', name: 'A', methods: 'password' })
    await expect(
      fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })
})

describe('verifyBindPassword', () => {
  it('POSTs body { token, identifier, password }', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'verified' })
    const client = makeClient({ post })
    const r = await verifyBindPassword(client, 'tok', 'alice', 'pw', { provider: 'aegis' })
    expect(post).toHaveBeenCalledWith(
      '/v1/auth/oidc/aegis/bind/verify/password',
      { token: 'tok', identifier: 'alice', password: 'pw' },
      { signal: undefined },
    )
    expect(r.status).toBe('verified')
  })

  it('rejects when status != verified', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'pending' })
    await expect(
      verifyBindPassword(makeClient({ post }), 't', 'i', 'p', { provider: 'aegis' }),
    ).rejects.toThrow()
  })
})

describe('sendBindOtp', () => {
  it('POSTs only { token }', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'sent' })
    await sendBindOtp(makeClient({ post }), 'tok', { provider: 'aegis' })
    expect(post).toHaveBeenCalledWith(
      '/v1/auth/oidc/aegis/bind/verify/otp/send',
      { token: 'tok' },
      { signal: undefined },
    )
  })

  it('does not include phone in body', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'sent' })
    await sendBindOtp(makeClient({ post }), 'tok', { provider: 'aegis' })
    const body = post.mock.calls[0][1]
    expect(body).toEqual({ token: 'tok' })
    expect(body).not.toHaveProperty('phone')
  })
})

describe('checkBindOtp', () => {
  it('POSTs { token, code }', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'verified' })
    await checkBindOtp(makeClient({ post }), 'tok', '123456', { provider: 'aegis' })
    expect(post).toHaveBeenCalledWith(
      '/v1/auth/oidc/aegis/bind/verify/otp/check',
      { token: 'tok', code: '123456' },
      { signal: undefined },
    )
  })
})

describe('confirmBind', () => {
  it('POSTs { token } and returns parsed shape', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'ok',
      login_resp: '{"uid":"u","token":"t"}',
      uid: 'u',
    })
    const r = await confirmBind(makeClient({ post }), 'tok', { provider: 'aegis' })
    expect(r.uid).toBe('u')
    expect(typeof r.login_resp).toBe('string')
  })

  it('rejects when login_resp is missing', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'ok', uid: 'u' })
    await expect(
      confirmBind(makeClient({ post }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })

  it('rejects when login_resp is empty', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'ok', login_resp: '', uid: 'u' })
    await expect(
      confirmBind(makeClient({ post }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })

  it('rejects when uid is missing', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'ok', login_resp: '{}' })
    await expect(
      confirmBind(makeClient({ post }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })

  it('rejects on non-ok status', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'pending', login_resp: 'x', uid: 'u' })
    await expect(
      confirmBind(makeClient({ post }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })
})

describe('fetchBindInfo allow_create / create_blocked (PR#93)', () => {
  it('passes through allow_create=true and create_blocked="" when claims are clean', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@x',
      name: 'A',
      methods: [],
      allow_create: true,
      create_blocked: '',
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info.allow_create).toBe(true)
    expect(info.create_blocked).toBe('')
  })

  it('passes through create_blocked="claims_incomplete"', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: '',
      name: 'A',
      methods: [],
      allow_create: true,
      create_blocked: 'claims_incomplete',
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info.create_blocked).toBe('claims_incomplete')
  })

  it('passes through create_blocked="manual_conflict"', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@x',
      name: 'A',
      methods: ['password'],
      allow_create: true,
      create_blocked: 'manual_conflict',
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info.create_blocked).toBe('manual_conflict')
  })

  it('downgrades unknown create_blocked values to "" (forward-compat)', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@x',
      name: 'A',
      methods: ['password'],
      allow_create: true,
      create_blocked: 'future_unknown_reason',
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info.create_blocked).toBe('')
  })

  it('leaves allow_create undefined when old backend omits the field', async () => {
    const get = vi.fn().mockResolvedValue({
      masked_email: 'a***@x',
      name: 'A',
      methods: ['password'],
    })
    const info = await fetchBindInfo(makeClient({ get }), 'tok', { provider: 'aegis' })
    expect(info).not.toHaveProperty('allow_create')
    expect(info).not.toHaveProperty('create_blocked')
  })
})

describe('createBind', () => {
  it('POSTs to /bind/create with { token }', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'ok',
      login_resp: '{"uid":"u","token":"t"}',
      uid: 'u-new',
    })
    await createBind(makeClient({ post }), 'tok', { provider: 'aegis' })
    expect(post).toHaveBeenCalledWith(
      '/v1/auth/oidc/aegis/bind/create',
      { token: 'tok' },
      { signal: undefined },
    )
  })

  it('returns login_resp + uid', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'ok',
      login_resp: '{"uid":"u-new","token":"t-new"}',
      uid: 'u-new',
    })
    const r = await createBind(makeClient({ post }), 'tok', { provider: 'aegis' })
    expect(r.uid).toBe('u-new')
    expect(r.login_resp).toContain('u-new')
  })

  it('rejects malformed response (missing login_resp)', async () => {
    const post = vi.fn().mockResolvedValue({ status: 'ok', uid: 'u' })
    await expect(
      createBind(makeClient({ post }), 'tok', { provider: 'aegis' }),
    ).rejects.toThrow()
  })

  it('falls back to aegis provider when missing', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'ok',
      login_resp: '{}',
      uid: 'u',
    })
    await createBind(makeClient({ post }), 'tok')
    expect(post.mock.calls[0][0]).toContain(`/v1/auth/oidc/${FALLBACK_PROVIDER_ID}/bind/create`)
  })
})

describe('token not in logs', () => {
  it('does not log token to console anywhere in the api layer', async () => {
    // 防御性测试: 任何 bind api 调用都不应触发 console.log/info/warn/error.
    // 这是 bind_token-in-URL limitation 缓解的一部分.
    const spies = ['log', 'info', 'warn', 'error'].map((m) =>
      vi.spyOn(console, m as 'log').mockImplementation(() => {}),
    )
    try {
      const client = makeClient({
        get: vi.fn().mockResolvedValue({
          masked_email: '',
          name: 'A',
          methods: [],
        }),
        post: vi
          .fn()
          .mockResolvedValueOnce({ status: 'verified' }) // verify_password
          .mockResolvedValueOnce({ status: 'sent' }), // otp/send
      })
      await fetchBindInfo(client, 'SECRET-TOK', { provider: 'aegis' })
      await verifyBindPassword(client, 'SECRET-TOK', 'u', 'p', { provider: 'aegis' })
      await sendBindOtp(client, 'SECRET-TOK', { provider: 'aegis' })
      for (const s of spies) {
        expect(s).not.toHaveBeenCalled()
      }
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })
})
