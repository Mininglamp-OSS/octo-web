import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * loginSuccess() 实名字段映射的单测。
 *
 * 背景：R9 的事故复盘（Coda 教训 memory 627798ef）——
 * 字段声明存在 ≠ 有人赋值。本文件把 loginSuccess 对后端新字段
 * `realname_verified` / `real_name` / `realname_verified_at` 的映射规则
 * 钉死，防止再次出现"改了 save/load 但没改 loginSuccess"的断链。
 *
 * 测试矩阵：
 *   1. 字段缺失（老后端）→ tri-state undefined（区别于明确 false）
 *   2. 布尔 true + real_name 非空 + verified_at 秒 → 全部正确映射
 *   3. 布尔 false → realnameVerified=false, realName=undefined
 *   4. 兼容字符串 "1" / "true" / "0" / "false"
 *   5. 未实名用户 real_name 缺失或空串 → realName=undefined
 */

const loginInfoStub = vi.hoisted(() => ({
  appID: '',
  uid: '',
  token: '',
  shortNo: '',
  name: '',
  sex: 0,
  loginProvider: undefined as string | undefined,
  realnameVerified: undefined as boolean | undefined,
  realName: undefined as string | undefined,
  realnameVerifiedAt: undefined as number | undefined,
  save: vi.fn(),
}))

vi.mock('@octo/base', () => {
  class ProviderListener {
    notifyListener = vi.fn()
  }
  const WKApp = {
    loginInfo: loginInfoStub,
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
    config: { themeColor: '#000', appName: 'Test' },
    remoteConfig: { oidcProviders: [] },
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

import { LoginVM } from '../login_vm'

function resetLoginInfo() {
  loginInfoStub.appID = ''
  loginInfoStub.uid = ''
  loginInfoStub.token = ''
  loginInfoStub.shortNo = ''
  loginInfoStub.name = ''
  loginInfoStub.sex = 0
  loginInfoStub.loginProvider = undefined
  loginInfoStub.realnameVerified = undefined
  loginInfoStub.realName = undefined
  loginInfoStub.realnameVerifiedAt = undefined
  loginInfoStub.save.mockClear()
}

describe('loginSuccess — realname payload mapping', () => {
  let vm: LoginVM

  beforeEach(() => {
    resetLoginInfo()
    vm = new LoginVM()
    // 避免后续 checkSpaceAndLogin 触发 space API 调用：mock 它。
    // @ts-ignore — private 方法
    vi.spyOn(vm as any, 'checkSpaceAndLogin').mockImplementation(() => {})
  })

  it('字段缺失（老后端兼容）→ tri-state 全部 undefined', () => {
    vm.loginSuccess({ uid: 'u1', token: 't1', name: 'alice' }, 'local')
    expect(loginInfoStub.realnameVerified).toBeUndefined()
    expect(loginInfoStub.realName).toBeUndefined()
    expect(loginInfoStub.realnameVerifiedAt).toBeUndefined()
    // loginInfo.save() 必须被调一次，把三个 undefined 落盘成「删 key」而非 "0"。
    expect(loginInfoStub.save).toHaveBeenCalledTimes(1)
  })

  it('布尔 true + real_name 非空 + verified_at 秒 → 全部映射', () => {
    vm.loginSuccess(
      {
        uid: 'u1',
        token: 't1',
        name: 'alice',
        realname_verified: true,
        real_name: '余嘉伟',
        realname_verified_at: 1715000000,
      },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(true)
    expect(loginInfoStub.realName).toBe('余嘉伟')
    expect(loginInfoStub.realnameVerifiedAt).toBe(1715000000)
  })

  it('布尔 false → realnameVerified=false, realName=undefined（严格区分于 undefined）', () => {
    vm.loginSuccess(
      {
        uid: 'u1',
        token: 't1',
        name: 'bob',
        realname_verified: false,
      },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(false)
    expect(loginInfoStub.realName).toBeUndefined()
    expect(loginInfoStub.realnameVerifiedAt).toBeUndefined()
  })

  it('字符串 "1" / "true" → realnameVerified=true（兼容后端序列化偏差）', () => {
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: '1', real_name: 'Alice' },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(true)
    resetLoginInfo()
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: 'true', real_name: 'Alice' },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(true)
  })

  it('字符串 "0" / "false" → realnameVerified=false', () => {
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: '0' },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(false)
    resetLoginInfo()
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: 'false' },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(false)
  })

  it('未实名 + real_name 缺失 → realName=undefined', () => {
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: false, real_name: '' },
      'acme-sso',
    )
    expect(loginInfoStub.realName).toBeUndefined()
  })

  it('已实名但 real_name 为空字符串（异常数据）→ realName=undefined 不污染 displayName', () => {
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: true, real_name: '' },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBe(true)
    expect(loginInfoStub.realName).toBeUndefined()
  })

  it('realname_verified_at 字符串数字 → 转成 number', () => {
    vm.loginSuccess(
      {
        uid: 'u1',
        token: 't1',
        realname_verified: true,
        real_name: '余嘉伟',
        realname_verified_at: '1715000000',
      },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerifiedAt).toBe(1715000000)
  })

  it('realname_verified_at 非法值（负数 / NaN） → undefined', () => {
    vm.loginSuccess(
      {
        uid: 'u1',
        token: 't1',
        realname_verified: true,
        real_name: '余嘉伟',
        realname_verified_at: -1,
      },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerifiedAt).toBeUndefined()
    resetLoginInfo()
    vm.loginSuccess(
      {
        uid: 'u1',
        token: 't1',
        realname_verified: true,
        real_name: '余嘉伟',
        realname_verified_at: 'not-a-number',
      },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerifiedAt).toBeUndefined()
  })

  it('未知的 realname_verified 值（null） → undefined（不坍塌成 false）', () => {
    vm.loginSuccess(
      { uid: 'u1', token: 't1', realname_verified: null },
      'acme-sso',
    )
    expect(loginInfoStub.realnameVerified).toBeUndefined()
  })
})
