import { describe, it, expect } from 'vitest'
// 深路径 import 真实实现, 绕开 @octo/base 的桶 export(会拖入 lottie 等重模块,
// 在 jsdom 环境里启动失败)。OidcConfig 是 leaf 文件, 零依赖。
import { parseOidcProviders } from '../../../dmworkbase/src/Service/OidcConfig'

describe('parseOidcProviders', () => {
  it('parses a well-formed provider entry into camelCase', () => {
    const result = parseOidcProviders([
      {
        id: 'acme-sso',
        name: 'Acme SSO',
        authorize_path: '/v1/auth/oidc/acme-sso/authorize',
        account_url: 'https://idp.example.com/account',
        reset_password_url: 'https://idp.example.com/reset',
      },
    ])
    expect(result).toEqual([
      {
        id: 'acme-sso',
        name: 'Acme SSO',
        authorizePath: '/v1/auth/oidc/acme-sso/authorize',
        accountUrl: 'https://idp.example.com/account',
        resetPasswordUrl: 'https://idp.example.com/reset',
      },
    ])
  })

  it('returns empty array when input is not an array', () => {
    expect(parseOidcProviders(null)).toEqual([])
    expect(parseOidcProviders(undefined)).toEqual([])
    expect(parseOidcProviders('nope')).toEqual([])
    expect(parseOidcProviders({ id: 'acme-sso' })).toEqual([])
  })

  it('skips entries missing required fields instead of throwing', () => {
    const result = parseOidcProviders([
      { id: 'acme-sso', name: 'Acme SSO' }, // 缺 authorize_path
      { name: 'Acme SSO', authorize_path: '/x' }, // 缺 id
      { id: 'acme-sso', authorize_path: '/x' }, // 缺 name
      null,
      'string',
      {
        id: 'good',
        name: 'Good',
        authorize_path: '/v1/auth/oidc/good/authorize',
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('good')
  })

  // 安全:authorize_path 拼进 window.location.href, 必须是站内相对路径。
  // 恶意/被劫持的后端把它写成 'javascript:alert(1)' 时浏览器会执行 JS。
  it('rejects authorize_path that is not a server-relative path', () => {
    const malicious = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example.com/authorize', // 绝对 URL 也拒绝, 防绕过同源
      '//evil.example.com/authorize',         // protocol-relative
      '/\\evil.example.com/authorize',        // URL normalizes backslash to a host
      'v1/auth/oidc/x/authorize',             // 不以 / 开头
      '',                                     // 空字符串
    ]
    for (const path of malicious) {
      const result = parseOidcProviders([
        { id: 'acme-sso', name: 'Acme SSO', authorize_path: path },
      ])
      expect(result).toEqual([])
    }
  })

  it('accepts valid server-relative authorize_path', () => {
    const result = parseOidcProviders([
      { id: 'a', name: 'A', authorize_path: '/v1/auth/oidc/a/authorize' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].authorizePath).toBe('/v1/auth/oidc/a/authorize')
  })

  it('drops javascript: account_url / reset_password_url via sanitizeHttpUrl', () => {
    const result = parseOidcProviders([
      {
        id: 'a',
        name: 'A',
        authorize_path: '/v1/auth/oidc/a/authorize',
        account_url: 'javascript:alert(1)',
        reset_password_url: 'data:text/html,xss',
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].accountUrl).toBeUndefined()
    expect(result[0].resetPasswordUrl).toBeUndefined()
  })
})
