import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyLoginResp, parseLoginResp } from '../loginSession'

vi.mock('@octo/base', () => ({
  WKApp: {
    loginInfo: {
      appID: '',
      uid: '',
      token: '',
      shortNo: '',
      name: '',
      sex: 0,
      loginProvider: '',
      realnameVerified: undefined,
      realName: undefined,
      realnameVerifiedAt: undefined,
      save: vi.fn(),
    },
  },
  i18n: {
    setLocale: vi.fn(),
  },
  normalizeLocale: vi.fn((value: string | null | undefined) => {
    if (value === 'zh-CN' || value === 'en-US') return value
    return undefined
  }),
}))

import { WKApp, i18n } from '@octo/base'

beforeEach(() => {
  // 重置 loginInfo 避免测试间污染
  Object.assign(WKApp.loginInfo, {
    appID: '',
    uid: '',
    token: '',
    shortNo: '',
    name: '',
    sex: 0,
    loginProvider: '',
    realnameVerified: undefined,
    realName: undefined,
    realnameVerifiedAt: undefined,
  })
  ;(WKApp.loginInfo.save as ReturnType<typeof vi.fn>).mockClear()
  ;(i18n.setLocale as ReturnType<typeof vi.fn>).mockClear()
})

describe('applyLoginResp', () => {
  it('writes uid/token/provider and saves', () => {
    // 用真实 IdP id 而非 synthetic 'oidc-bind' 标签 — BindPage 传
    // entry.provider (resolveProvider 已对齐), 测试反映真实合同, 不锁死合成值.
    // 下游 NavSettingsPanel/realnameVerifyUrl 按 id 在 oidcProviders 中 find,
    // synthetic 值会让 lookup 全部失败.
    applyLoginResp({ uid: 'u1', token: 'tok', app_id: 'a', name: 'Alice' }, 'aegis')
    expect(WKApp.loginInfo.uid).toBe('u1')
    expect(WKApp.loginInfo.token).toBe('tok')
    expect(WKApp.loginInfo.appID).toBe('a')
    expect(WKApp.loginInfo.name).toBe('Alice')
    expect(WKApp.loginInfo.loginProvider).toBe('aegis')
    expect(WKApp.loginInfo.save).toHaveBeenCalledOnce()
  })

  it('throws on missing uid', () => {
    expect(() => applyLoginResp({ token: 't' }, 'p')).toThrow()
  })

  it('throws on missing token', () => {
    expect(() => applyLoginResp({ uid: 'u' }, 'p')).toThrow()
  })

  it('throws on empty uid', () => {
    expect(() => applyLoginResp({ uid: '', token: 't' }, 'p')).toThrow()
  })

  it('preserves tri-state realname (true)', () => {
    applyLoginResp(
      { uid: 'u', token: 't', realname_verified: true, real_name: 'Alice', realname_verified_at: 1700000000 },
      'oidc',
    )
    expect(WKApp.loginInfo.realnameVerified).toBe(true)
    expect(WKApp.loginInfo.realName).toBe('Alice')
    expect(WKApp.loginInfo.realnameVerifiedAt).toBe(1700000000)
  })

  it('preserves tri-state realname (explicit false)', () => {
    applyLoginResp(
      { uid: 'u', token: 't', realname_verified: false },
      'oidc',
    )
    expect(WKApp.loginInfo.realnameVerified).toBe(false)
  })

  it('preserves tri-state realname (missing → undefined, NOT false)', () => {
    applyLoginResp({ uid: 'u', token: 't' }, 'oidc')
    expect(WKApp.loginInfo.realnameVerified).toBeUndefined()
    expect(WKApp.loginInfo.realName).toBeUndefined()
    expect(WKApp.loginInfo.realnameVerifiedAt).toBeUndefined()
  })

  it('accepts realname_verified as "1" string', () => {
    applyLoginResp({ uid: 'u', token: 't', realname_verified: '1' }, 'oidc')
    expect(WKApp.loginInfo.realnameVerified).toBe(true)
  })

  it('accepts realname_verified_at as numeric string', () => {
    applyLoginResp({ uid: 'u', token: 't', realname_verified_at: '1700000000' }, 'oidc')
    expect(WKApp.loginInfo.realnameVerifiedAt).toBe(1700000000)
  })

  it('drops realname_verified_at when 0', () => {
    applyLoginResp({ uid: 'u', token: 't', realname_verified_at: 0 }, 'oidc')
    expect(WKApp.loginInfo.realnameVerifiedAt).toBeUndefined()
  })

  it('applies non-empty backend language preference', () => {
    applyLoginResp({ uid: 'u', token: 't', language: 'en-US' }, 'oidc')
    expect(i18n.setLocale).toHaveBeenCalledWith('en-US')
    expect(WKApp.loginInfo.save).toHaveBeenCalledOnce()
  })

  it('does not override local language when backend language is empty or missing', () => {
    applyLoginResp({ uid: 'u', token: 't', language: '' }, 'oidc')
    applyLoginResp({ uid: 'u', token: 't' }, 'oidc')
    expect(i18n.setLocale).not.toHaveBeenCalled()
  })

  it('ignores unsupported backend language values', () => {
    applyLoginResp({ uid: 'u', token: 't', language: 'fr-FR' }, 'oidc')
    expect(i18n.setLocale).not.toHaveBeenCalled()
  })
})

describe('parseLoginResp', () => {
  it('parses JSON-encoded login response', () => {
    const raw = JSON.stringify({ uid: 'u', token: 't' })
    expect(parseLoginResp(raw)).toEqual({ uid: 'u', token: 't' })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseLoginResp('{not json')).toThrow(/Invalid login_resp/)
  })

  it('throws on non-object JSON', () => {
    expect(() => parseLoginResp('[1,2,3]')).toThrow(/not an object/)
    expect(() => parseLoginResp('"string"')).toThrow(/not an object/)
  })
})
