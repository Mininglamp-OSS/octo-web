import { OidcBindHttpError } from '../oidc/http'

// 错误码 → 用户文案映射. 文档表格 §3.1-§3.5 把每个端点的 400/401/409/410/429/500/503
// 都列了, 这里按端点上下文给出更具体的提示, 而不是一刀切.
//
// terminal=true 表示该错误不可在 bind 流程内恢复, UI 必须给"重新走 OIDC 登录"出口;
// terminal=false 表示用户改输入后可重试.

export type BindEndpoint = 'info' | 'verify_password' | 'verify_otp_send' | 'verify_otp_check' | 'confirm' | 'create'

export interface BindErrorDisplay {
  message: string
  terminal: boolean
  // 503 / 5xx 时给重试按钮
  retryable?: boolean
}

const DEFAULT: BindErrorDisplay = {
  message: '操作失败，请重试',
  terminal: false,
}

export function mapBindError(
  endpoint: BindEndpoint,
  err: unknown,
): BindErrorDisplay {
  if (!(err instanceof OidcBindHttpError)) {
    // 网络层 / 反序列化失败. 不区分端点统一兜底.
    return { message: '网络异常，请检查后重试', terminal: false, retryable: true }
  }
  const s = err.status

  // 跨端点共通: 400/410 一律 terminal — token 没救了.
  if (s === 400) return { message: '链接已失效，请重新发起登录', terminal: true }
  if (s === 410) return { message: '链接已过期，请重新发起登录', terminal: true }
  if (s === 503) return { message: '绑定服务暂不可用，请稍后重试', terminal: false, retryable: true }
  if (s === 500) return { message: '服务异常，请稍后重试', terminal: false, retryable: true }
  // 422 仅出现在 /bind/create: SSO claims 缺 verified email/phone — 后端无法构造账号.
  // 是 terminal: 这条 bind_token 上不会"突然有"邮箱/手机, 让用户走联系管理员路径.
  if (s === 422) return { message: 'SSO 身份信息不完整（缺邮箱或手机），无法自助创建账号', terminal: true }

  // 端点级语义
  switch (endpoint) {
    case 'info':
      return DEFAULT
    case 'verify_password':
      if (s === 401) return { message: '用户名或密码错误', terminal: false }
      if (s === 409) return { message: '验证已通过，请继续完成绑定', terminal: false }
      if (s === 429) return { message: '尝试次数过多，请稍后再试', terminal: false }
      return DEFAULT
    case 'verify_otp_send':
      if (s === 401) return { message: '无法发送验证码，请尝试其他验证方式', terminal: false }
      if (s === 429) return { message: '发送过于频繁，请稍后再试', terminal: false }
      return DEFAULT
    case 'verify_otp_check':
      if (s === 401) return { message: '验证码错误或已过期', terminal: false }
      if (s === 409) return { message: '验证已通过，请继续完成绑定', terminal: false }
      if (s === 429) return { message: '尝试次数过多，请稍后再试', terminal: false }
      return DEFAULT
    case 'confirm':
      if (s === 401) return { message: '请先完成身份验证', terminal: false }
      // 409 在 confirm 端点是 "identity 已绑定" — 实际是恢复路径成功的信号,
      // 此时该用户的 OIDC autolink 已经能命中, 引导回登录即可.
      if (s === 409) return { message: '该账号已绑定，请返回登录页重新使用 SSO 登录', terminal: true }
      if (s === 429) return { message: '尝试次数过多，请稍后再试', terminal: false }
      return DEFAULT
    case 'create':
      // PR#93: bindCreateMax = 1, 一次失败 token 即不可重用 → 429 必然 terminal.
      if (s === 429) return { message: '已尝试创建账号，请重新发起 SSO 登录', terminal: true }
      // 409 有两种 sentinel:
      //   ErrBindStatusConflict — token 已过 issued (并发 verify/create 占用了)
      //   ErrBindAlreadyBound — (issuer,sub) 唯一键撞了, identity 已存在
      //   ErrBindCreateConflictNeedManual — claims 命中多个 dmwork 账号, 不能自助创建
      // 三个对用户的下一步都不同, 但本期统一引导回登录 + 提示联系管理员的 fallback.
      // 后端 msg 字段会给出区分, 但 UI 不读 msg (反枚举原则), 这里 terminal=true 即可.
      if (s === 409) return { message: '账号信息冲突，请联系管理员或返回登录页重试', terminal: true }
      if (s === 401) return { message: '当前 SSO 身份无创建权限', terminal: true }
      return DEFAULT
  }
}
