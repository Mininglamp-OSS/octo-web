// 后端 PR#73 (feat/oidc-bind-self-service) 自助绑定流程响应类型.
// 文档: octo-server docs/octo-aegis/oidc-bind-frontend.md

// 可用的二次验证方法. 来自后端 cfg.Methods ∩ claims 支持:
// - claims 无 verified phone 时 'sms_otp' 不会出现在 methods[] 里
export type BindMethod = 'password' | 'sms_otp'

// /bind/info 的 create_blocked 字段取值. 后端永远序列化此字段 (不会 omitempty),
// 所以 '' 与 'disabled' 语义不同 — 见 server PR#93 的 Info precedence 说明:
//   disabled > claims_incomplete > manual_conflict > consumed
// - ''                  → create 可用, UI 显示主按钮可点
// - 'disabled'          → 运维关掉了开关, UI 完全隐藏 create 入口
// - 'claims_incomplete' → IdP claims 无 verified email/phone, 无法自助创建
// - 'manual_conflict'   → claims 命中多个 dmwork 账号, 必须人工合并
// - 'consumed'          → token 已被 verify 或 create 使用过, 必须重走 OIDC
export type BindCreateBlocked =
  | ''
  | 'disabled'
  | 'claims_incomplete'
  | 'manual_conflict'
  | 'consumed'

export interface BindInfoResp {
  // claims 无邮箱时为空串. masked_phone 在 claims 无手机号时**字段缺失**,
  // 不要用 === '' 判断 — 这是文档 §3.7 明确的契约.
  masked_email: string
  masked_phone?: string
  name: string
  methods: BindMethod[]
  // 兜底联系方式, env 配置, 可空.
  support_contact?: string
  // 后端 PR#93 扩展: 自助创建账号支持. 老后端不返这两个字段时, FE 视为
  // allow_create=false / create_blocked='' (即不显示 create 按钮, 退回老 UX).
  allow_create?: boolean
  create_blocked?: BindCreateBlocked
}

// /bind/create 响应与 /bind/confirm 同 shape, 单独命名让契约可追溯.
export interface BindCreateResp {
  status: 'ok'
  login_resp: string
  uid: string
}

export interface BindVerifyResp {
  // 'verified' | 'sent'. password/otp_check 返 'verified'; otp_send 返 'sent'.
  status: 'verified' | 'sent'
}

export interface BindConfirmResp {
  status: 'ok'
  // JSON-encoded string, 必须 JSON.parse 后才能拿到登录 payload (与老 OIDC
  // authstatus.result 同 schema, 经后端同一份 execLogin 生成).
  login_resp: string
  uid: string
}

// bind 页面三参数, 来自 OIDC callback 302 时挂在 URL 上.
// token 视为凭据, 等同一次密码登录会话; 见 url.ts 的 token 安全约束.
export interface BindEntryParams {
  token: string
  authcode: string
  returnTo: string
  // 从 URL 取的 provider id. 缺失时调用方应回退到 fallback 并埋点.
  provider?: string
}

// state machine: issued (URL 入口) → verified (verify 成功) → consumed (confirm 成功).
// 后端 CAS 不允许回退到 issued; verified 后再调 verify 端点返 409.
export type BindStage = 'issued' | 'verifying' | 'verified' | 'confirming' | 'consumed'
