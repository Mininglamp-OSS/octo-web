import { describe, it, expect } from 'vitest'
import { mapBindError } from '../errorMessages'
import { OidcBindHttpError } from '../../oidc/http'

describe('mapBindError', () => {
  it('treats non-Http errors as retryable network failure', () => {
    const r = mapBindError('info', new Error('socket reset'))
    expect(r.terminal).toBe(false)
    expect(r.retryable).toBe(true)
  })

  it('flags 400/410 as terminal on any endpoint', () => {
    expect(mapBindError('info', new OidcBindHttpError(400)).terminal).toBe(true)
    expect(mapBindError('verify_password', new OidcBindHttpError(410)).terminal).toBe(true)
    expect(mapBindError('confirm', new OidcBindHttpError(410)).terminal).toBe(true)
  })

  it('flags 503/500 as retryable non-terminal', () => {
    const r5 = mapBindError('verify_password', new OidcBindHttpError(503))
    expect(r5.terminal).toBe(false)
    expect(r5.retryable).toBe(true)
    const r6 = mapBindError('confirm', new OidcBindHttpError(500))
    expect(r6.terminal).toBe(false)
    expect(r6.retryable).toBe(true)
  })

  it('verify_password 401 is non-terminal with password-specific copy', () => {
    const r = mapBindError('verify_password', new OidcBindHttpError(401))
    expect(r.terminal).toBe(false)
    expect(r.message).toMatch(/密码/)
  })

  it('verify_otp_check 401 is non-terminal with otp-specific copy', () => {
    const r = mapBindError('verify_otp_check', new OidcBindHttpError(401))
    expect(r.message).toMatch(/验证码/)
  })

  it('confirm 409 is terminal (identity already bound recovery path)', () => {
    const r = mapBindError('confirm', new OidcBindHttpError(409))
    expect(r.terminal).toBe(true)
    expect(r.message).toMatch(/已绑定|SSO/)
  })

  it('confirm 401 (not verified) is non-terminal', () => {
    const r = mapBindError('confirm', new OidcBindHttpError(401))
    expect(r.terminal).toBe(false)
  })

  it('429 is non-terminal across endpoints', () => {
    for (const ep of ['verify_password', 'verify_otp_send', 'verify_otp_check', 'confirm'] as const) {
      expect(mapBindError(ep, new OidcBindHttpError(429)).terminal).toBe(false)
    }
  })

  // ---- /bind/create specific (PR#93) -----------------------------------
  // bindCreateMax=1: 一次失败 token 即不可用, 所有 create 失败都 terminal.

  it('create 429 is terminal (bindCreateMax=1)', () => {
    const r = mapBindError('create', new OidcBindHttpError(429))
    expect(r.terminal).toBe(true)
    expect(r.message).toMatch(/重新发起 SSO/)
  })

  it('create 409 (any conflict variant) is terminal with manual-resolve hint', () => {
    const r = mapBindError('create', new OidcBindHttpError(409, 'account conflict needs manual resolution'))
    expect(r.terminal).toBe(true)
    expect(r.message).toMatch(/账号信息冲突|联系管理员/)
  })

  it('create 422 (claims incomplete) is terminal', () => {
    const r = mapBindError('create', new OidcBindHttpError(422))
    expect(r.terminal).toBe(true)
    expect(r.message).toMatch(/信息不完整|无法自助创建/)
  })

  it('create 401 (issuer removed mid-flight) is terminal', () => {
    const r = mapBindError('create', new OidcBindHttpError(401))
    expect(r.terminal).toBe(true)
  })

  it('create 503/500 stays retryable', () => {
    expect(mapBindError('create', new OidcBindHttpError(503)).retryable).toBe(true)
    expect(mapBindError('create', new OidcBindHttpError(500)).retryable).toBe(true)
  })
})
