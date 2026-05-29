import { WKApp, i18n, normalizeLocale } from '@octo/base'

// LoginRespJSON 的字段子集. 用 unknown / any 避免对后端 schema 过度约束:
// 不同登录入口 (password / sms / OIDC autolink / OIDC bind confirm) 走的是同
// 一份后端 execLogin, 但 dmwork 也有少数实验字段, 这里只校验登录必备的两项.
export interface LoginRespFields {
  uid?: unknown
  token?: unknown
  app_id?: unknown
  short_no?: unknown
  name?: unknown
  sex?: unknown
  realname_verified?: unknown
  real_name?: unknown
  realname_verified_at?: unknown
  language?: unknown
  [k: string]: unknown
}

function applyBackendLanguagePreference(language: unknown): void {
  if (typeof language !== 'string' || language === '') return
  const locale = normalizeLocale(language)
  if (!locale) return
  i18n.setLocale(locale)
}

/**
 * applyLoginResp 把后端登录响应映射到 WKApp.loginInfo 并持久化.
 *
 * 调用方:
 *  - LoginVM.loginSuccess (密码 / 短信 / 二维码 / OIDC autolink 短码轮询)
 *  - BindPage (OIDC bind confirm 成功后, login_resp 经 JSON.parse 后)
 *
 * 两条路径走的是后端同一份 execLogin (modules/oidc bind confirm 复用
 * userSvc.LoginByExternalIdentity → externalLoginExisting), schema 一致.
 *
 * 不做的事:
 *  - 不清表单字段 (那是 LoginVM 自己的事)
 *  - 不触发任何导航 / callOnLogin / space 检查 (由调用方负责: LoginVM 走
 *    checkSpaceAndLogin; BindPage 走 navigate(return_to))
 */
export function applyLoginResp(data: LoginRespFields, provider: string): void {
  if (
    !data ||
    typeof data.uid !== 'string' ||
    data.uid === '' ||
    typeof data.token !== 'string' ||
    data.token === ''
  ) {
    throw new Error('Invalid login response: missing required fields (uid, token)')
  }
  const loginInfo = WKApp.loginInfo
  loginInfo.appID = typeof data.app_id === 'string' ? data.app_id : ''
  loginInfo.uid = data.uid
  loginInfo.token = data.token
  loginInfo.shortNo = typeof data.short_no === 'string' ? data.short_no : ''
  loginInfo.name = typeof data.name === 'string' ? data.name : ''
  loginInfo.sex = typeof data.sex === 'number' ? data.sex : 0
  loginInfo.loginProvider = provider

  // 实名 tri-state: undefined 表示"未知" (老后端字段缺失场景), 不能塌缩为 false.
  // 原由保留在 login_vm.tsx 旧实现的注释里 (memory 627798ef): 后续 /v1/users/:uid
  // 刷新会覆盖, undefined 是它的初始读位.
  const rv = data.realname_verified
  if (rv === true || rv === 1 || rv === '1' || rv === 'true') {
    loginInfo.realnameVerified = true
  } else if (rv === false || rv === 0 || rv === '0' || rv === 'false') {
    loginInfo.realnameVerified = false
  } else {
    loginInfo.realnameVerified = undefined
  }
  if (typeof data.real_name === 'string' && data.real_name.length > 0) {
    loginInfo.realName = data.real_name
  } else {
    loginInfo.realName = undefined
  }
  const rvAt = data.realname_verified_at
  if (typeof rvAt === 'number' && rvAt > 0) {
    loginInfo.realnameVerifiedAt = rvAt
  } else if (typeof rvAt === 'string' && rvAt !== '') {
    const n = Number(rvAt)
    loginInfo.realnameVerifiedAt = Number.isFinite(n) && n > 0 ? n : undefined
  } else {
    loginInfo.realnameVerifiedAt = undefined
  }

  applyBackendLanguagePreference(data.language)
  loginInfo.save()
}

/**
 * parseLoginResp 把 bind confirm 返回的 JSON-encoded string 解出.
 *
 * 与老 OIDC authstatus.result 不同, bind 流程 login_resp 是字符串 (后端用
 * json.Marshal 后再放进 wrapper) — 详见 oidc-bind-frontend.md §2.3 / §3.5.
 * 解析失败抛 Error, 让 UI 落 500 文案 (实际只可能发生在后端串错 schema).
 */
export function parseLoginResp(raw: string): LoginRespFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid login_resp: not JSON (${(e as Error).message})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid login_resp: not an object')
  }
  return parsed as LoginRespFields
}
