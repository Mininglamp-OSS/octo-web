import { OidcBindHttpError } from '../oidc/http'
import { loginT as t } from '../i18n'

// 错误码 → 用户文案映射. 文档表格 §3.1-§3.5 把每个端点的 400/401/409/410/429/500/503
// 都列了, 这里按端点上下文给出更具体的提示, 而不是一刀切.
//
// terminal=true 表示该错误不可在 bind 流程内恢复, UI 必须给"重新走 OIDC 登录"出口;
// terminal=false 表示用户改输入后可重试.

export type BindEndpoint = 'info' | 'verify_password' | 'verify_otp_send' | 'verify_otp_check' | 'confirm' | 'create'

export interface BindErrorDisplay {
  message: string
  terminal: boolean
}

function display(key: string, terminal: boolean): BindErrorDisplay {
  return {
    message: t(`bindErrors.${key}`),
    terminal,
  }
}

// confirm / create are post-verify endpoints: the BindPage loader stage cannot
// surface inlineError. Any failure there (HTTP or non-HTTP — network timeout,
// fetch abort, parseLoginResp JSON parse, applyLoginResp invariant throw) MUST
// be terminal to avoid stranding the user on the spinner. PR #72 review round 2.
function isPostVerifyEndpoint(endpoint: BindEndpoint): boolean {
  return endpoint === 'confirm' || endpoint === 'create'
}

export function mapBindError(
  endpoint: BindEndpoint,
  err: unknown,
): BindErrorDisplay {
  if (!(err instanceof OidcBindHttpError)) {
    // Non-HTTP failure (network/abort/parse/validate). Interactive endpoints
    // can keep this retryable since their stage renders inlineError; post-verify
    // endpoints must terminate so the user gets a "返回登录" CTA.
    if (isPostVerifyEndpoint(endpoint)) {
      return display('bindFailed', true)
    }
    return display('network', false)
  }
  const s = err.status

  // 跨端点共通: 400/410 一律 terminal — token 没救了.
  if (s === 400) return display('invalid', true)
  if (s === 410) return display('expired', true)
  // 422 仅出现在 /bind/create: SSO claims 缺 verified email/phone — 后端无法构造账号.
  // 是 terminal: 这条 bind_token 上不会"突然有"邮箱/手机, 让用户走联系管理员路径.
  if (s === 422) return display('claimsIncomplete', true)
  // 500/503 不在这里 early-return: 交互端点 (info/verify_*) 还能重试, post-verify
  // 端点 (confirm/create) 的 loader stage 不渲染 inlineError 必须 terminal —
  // 见 PR #72 review B1. 下面 switch 按 endpoint 分别处理.
  const fiveXX = s === 500 || s === 503
  const isInteractive = endpoint === 'info' || endpoint === 'verify_password'
    || endpoint === 'verify_otp_send' || endpoint === 'verify_otp_check'
  if (fiveXX && isInteractive) {
    return s === 503
      ? display('serviceUnavailable', false)
      : display('server', false)
  }

  // 端点级语义
  switch (endpoint) {
    case 'info':
      return display('default', false)
    case 'verify_password':
      if (s === 401) return display('passwordInvalid', false)
      if (s === 409) return display('verified', false)
      if (s === 429) return display('retryLater', false)
      return display('default', false)
    case 'verify_otp_send':
      if (s === 401) return display('sendOtpFailed', false)
      if (s === 429) return display('sendTooOften', false)
      return display('default', false)
    case 'verify_otp_check':
      if (s === 401) return display('verifyCodeInvalid', false)
      if (s === 409) return display('verified', false)
      if (s === 429) return display('retryLater', false)
      return display('default', false)
    case 'confirm':
      // 409 在 confirm 端点是 "identity 已绑定" — 恢复路径成功的信号, OIDC
      // autolink 下次会命中, 引导回登录即可.
      if (s === 409) return display('alreadyBound', true)
      // confirm 端点本质 post-verify: BindPage 的 `confirming` loader 不渲染
      // inlineError. 所有失败 (401 / 429 / 5xx / 未识别) 一律 terminal 让用户
      // 重走 OIDC — PR #72 review B1 + round 2.
      if (s === 401) return display('needVerify', true)
      if (s === 429) return display('tooManyRestart', true)
      if (s === 500 || s === 503) return display('bindFailed', true)
      return display('bindFailed', true)
    case 'create':
      // PR#93: bindCreateMax = 1, 一次失败 token 即不可重用 → 429 必然 terminal.
      if (s === 429) return display('createAttempted', true)
      // 409 有三种 sentinel (ErrBindStatusConflict / ErrBindAlreadyBound /
      // ErrBindCreateConflictNeedManual), 用户下一步都是回登录, 反枚举原则下
      // UI 不区分 msg 内容, 一律 terminal.
      if (s === 409) return display('createConflict', true)
      if (s === 401) return display('createUnauthorized', true)
      // create 的 500/503/未识别: 同 confirm 推理, terminal 防 spinner 死锁.
      if (s === 500 || s === 503) return display('createFailed', true)
      return display('createFailed', true)
  }
}
