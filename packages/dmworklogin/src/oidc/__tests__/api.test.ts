import { describe, it, expect, vi } from 'vitest'
import { fetchAuthcode, fetchAuthStatus } from '../api'
import type { OidcHttpClient } from '../api'

function makeClient(impl: OidcHttpClient['get']): OidcHttpClient {
  return { get: impl, post: vi.fn() }
}

describe('fetchAuthcode', () => {
  it('GETs /v1/user/thirdlogin/authcode and returns authcode field', async () => {
    const get = vi.fn().mockResolvedValue({ authcode: 'abc-uuid' })
    const client = makeClient(get)
    const result = await fetchAuthcode(client)
    expect(result).toBe('abc-uuid')
    expect(get).toHaveBeenCalledWith('/v1/user/thirdlogin/authcode', undefined)
  })

  it('rejects when authcode field is missing', async () => {
    const client = makeClient(vi.fn().mockResolvedValue({}))
    await expect(fetchAuthcode(client)).rejects.toThrow()
  })
})

describe('fetchAuthStatus', () => {
  it('GETs /v1/user/thirdlogin/authstatus with authcode query', async () => {
    const get = vi.fn().mockResolvedValue({ status: 1, result: { uid: 'u1', token: 't' } })
    const client = makeClient(get)
    const result = await fetchAuthStatus(client, 'abc-uuid')
    expect(result.status).toBe(1)
    expect(result.result?.uid).toBe('u1')
    expect(get).toHaveBeenCalledWith(
      '/v1/user/thirdlogin/authstatus?authcode=abc-uuid',
      undefined,
    )
  })

  it('encodes authcode in query string', async () => {
    const get = vi.fn().mockResolvedValue({ status: 0 })
    const client = makeClient(get)
    await fetchAuthStatus(client, 'a b&c')
    expect(get).toHaveBeenCalledWith(
      '/v1/user/thirdlogin/authstatus?authcode=a+b%26c',
      undefined,
    )
  })

  it('passes through pending status (0)', async () => {
    const client = makeClient(vi.fn().mockResolvedValue({ status: 0 }))
    const result = await fetchAuthStatus(client, 'x')
    expect(result.status).toBe(0)
  })

  it('passes through failed status (2) with msg', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue({ status: 2, msg: '登录状态已过期' }),
    )
    const result = await fetchAuthStatus(client, 'x')
    expect(result.status).toBe(2)
    expect(result.msg).toBe('登录状态已过期')
  })

  it('rejects when status is not a number', async () => {
    const client = makeClient(vi.fn().mockResolvedValue({ status: '1' }))
    await expect(fetchAuthStatus(client, 'x')).rejects.toThrow()
  })

  it('rejects when response is null', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(null))
    await expect(fetchAuthStatus(client, 'x')).rejects.toThrow()
  })

  it('rejects on success status (1) when result.uid or result.token missing', async () => {
    const c1 = makeClient(vi.fn().mockResolvedValue({ status: 1, result: { uid: 'u' } }))
    await expect(fetchAuthStatus(c1, 'x')).rejects.toThrow()
    const c2 = makeClient(vi.fn().mockResolvedValue({ status: 1 }))
    await expect(fetchAuthStatus(c2, 'x')).rejects.toThrow()
  })
})
