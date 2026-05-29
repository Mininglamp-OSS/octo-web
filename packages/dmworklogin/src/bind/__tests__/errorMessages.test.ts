import { describe, it, expect, beforeEach } from 'vitest'
import { i18n } from '@octo/base/src/i18n/instance'
import { mapBindError } from '../errorMessages'
import { OidcBindHttpError } from '../../oidc/http'

describe('mapBindError', () => {
  beforeEach(() => {
    i18n.setLocale('zh-CN', { persist: false })
  })

  it('treats non-Http errors as retryable on interactive endpoints', () => {
    const r = mapBindError('info', new Error('socket reset'))
    expect(r.terminal).toBe(false)
    // (retryable field removed in round 2 — was set but never read)
  })

  // PR #72 review round 2 (Jerry-Xin): post-verify endpoints cannot show
  // inlineError, so even non-HTTP failures (timeout, abort, parseLoginResp
  // throw, applyLoginResp invariant throw) must terminate the flow.
  it('treats non-Http errors as terminal on confirm/create endpoints', () => {
    for (const ep of ['confirm', 'create'] as const) {
      const r = mapBindError(ep, new Error('timeout'))
      expect(r.terminal).toBe(true)
      const r2 = mapBindError(ep, new SyntaxError('Unexpected token'))
      expect(r2.terminal).toBe(true)
    }
  })

  // PR #72 review round 2 (yujiawei): confirm 401 was still non-terminal,
  // same stuck-spinner failure mode as B1 — reclassify as terminal.
  it('confirm 401 is terminal (was non-terminal in round 1)', () => {
    const r = mapBindError('confirm', new OidcBindHttpError(401))
    expect(r.terminal).toBe(true)
    expect(r.message).toMatch(/重新发起 SSO/)
  })

  it('flags 400/410 as terminal on any endpoint', () => {
    expect(mapBindError('info', new OidcBindHttpError(400)).terminal).toBe(true)
    expect(mapBindError('verify_password', new OidcBindHttpError(410)).terminal).toBe(true)
    expect(mapBindError('confirm', new OidcBindHttpError(410)).terminal).toBe(true)
  })

  it('flags 503/500 as retryable non-terminal on interactive endpoints', () => {
    const r5 = mapBindError('verify_password', new OidcBindHttpError(503))
    expect(r5.terminal).toBe(false)
    // retryable removed
    const r6 = mapBindError('verify_otp_check', new OidcBindHttpError(500))
    expect(r6.terminal).toBe(false)
    // retryable removed
  })

  // PR #72 review B1: confirm/create loader stages don't render inlineError,
  // so any post-verify failure must be terminal to avoid stranding the user
  // on an infinite spinner.
  it('confirm 500/503/429 are terminal (no recovery from confirming stage)', () => {
    for (const code of [429, 500, 503]) {
      const r = mapBindError('confirm', new OidcBindHttpError(code))
      expect(r.terminal).toBe(true)
      expect(r.message).toMatch(/重新发起 SSO|绑定失败/)
    }
  })

  it('create 500/503 are terminal (consistent with create 429)', () => {
    for (const code of [500, 503]) {
      const r = mapBindError('create', new OidcBindHttpError(code))
      expect(r.terminal).toBe(true)
    }
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

  // Superseded by the new "confirm 401 is terminal" test above (round 2).
  // Kept here as a documentation breadcrumb of what the prior contract was.

  it('429 is non-terminal on verify_* endpoints (user can retry input)', () => {
    for (const ep of ['verify_password', 'verify_otp_send', 'verify_otp_check'] as const) {
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

})
