import type { OidcHttpClient, OidcRequestInit } from '../api'
import type {
  BindInfoResp,
  BindVerifyResp,
  BindConfirmResp,
  BindCreateResp,
  BindCreateBlocked,
  BindMethod,
} from './types'

// 已知 create_blocked 取值. 后端可能将来增加新原因, 这里只把已知项强类型化;
// 未知值降级为 '' (不显示阻塞文案) 但仍透传给上层做埋点 — 防御性 forward-compat.
const KNOWN_CREATE_BLOCKED: ReadonlySet<BindCreateBlocked> = new Set([
  '',
  'disabled',
  'claims_incomplete',
  'manual_conflict',
  'consumed',
])

// 与后端 modules/oidc 的 legacyProviderPathID 对齐. 当前端 URL 没带 provider
// 时 (兼容旧后端 / 漏配) 回退到 aegis. 后端目前同时挂了 cfg.Provider.ID 和
// aegis 两套路由, 所以回退安全.
export const FALLBACK_PROVIDER_ID = 'aegis'

// telemetry 钩子: provider 缺失时由调用方上报埋点便于排查.
// 设计成可注入而非直接调 console / SDK, 让单测能断言 token 不会泄漏到日志.
export type BindTelemetry = {
  onProviderFallback?: (reason: 'missing' | 'invalid') => void
}

function resolveProvider(provider: string | undefined, t?: BindTelemetry): string {
  if (typeof provider === 'string' && /^[a-z0-9_-]+$/i.test(provider)) {
    return provider
  }
  t?.onProviderFallback?.(provider === undefined ? 'missing' : 'invalid')
  return FALLBACK_PROVIDER_ID
}

function pathFor(provider: string, suffix: string): string {
  return `/v1/auth/oidc/${encodeURIComponent(provider)}/bind/${suffix}`
}

export interface BindApiOptions extends OidcRequestInit {
  provider?: string
  telemetry?: BindTelemetry
}

export async function fetchBindInfo(
  client: OidcHttpClient,
  token: string,
  opts?: BindApiOptions,
): Promise<BindInfoResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const qs = new URLSearchParams({ token }).toString()
  const url = `${pathFor(provider, 'info')}?${qs}`
  const resp = await client.get<unknown>(url, { signal: opts?.signal })
  return validateBindInfo(resp)
}

export async function verifyBindPassword(
  client: OidcHttpClient,
  token: string,
  identifier: string,
  password: string,
  opts?: BindApiOptions,
): Promise<BindVerifyResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const resp = await client.post<unknown>(
    pathFor(provider, 'verify/password'),
    { token, identifier, password },
    { signal: opts?.signal },
  )
  return validateVerifyResp(resp, 'verified')
}

export async function sendBindOtp(
  client: OidcHttpClient,
  token: string,
  opts?: BindApiOptions,
): Promise<BindVerifyResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const resp = await client.post<unknown>(
    pathFor(provider, 'verify/otp/send'),
    { token },
    { signal: opts?.signal },
  )
  return validateVerifyResp(resp, 'sent')
}

export async function checkBindOtp(
  client: OidcHttpClient,
  token: string,
  code: string,
  opts?: BindApiOptions,
): Promise<BindVerifyResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const resp = await client.post<unknown>(
    pathFor(provider, 'verify/otp/check'),
    { token, code },
    { signal: opts?.signal },
  )
  return validateVerifyResp(resp, 'verified')
}

export async function confirmBind(
  client: OidcHttpClient,
  token: string,
  opts?: BindApiOptions,
): Promise<BindConfirmResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const resp = await client.post<unknown>(
    pathFor(provider, 'confirm'),
    { token },
    { signal: opts?.signal },
  )
  return validateConfirmResp(resp)
}

// POST /bind/create — 自助从 SSO claims 直接创建 Octo 账号 (server PR#93).
// 响应 shape 与 /bind/confirm 完全一致 (后端复用同一份 LoginRespJSON builder).
export async function createBind(
  client: OidcHttpClient,
  token: string,
  opts?: BindApiOptions,
): Promise<BindCreateResp> {
  const provider = resolveProvider(opts?.provider, opts?.telemetry)
  const resp = await client.post<unknown>(
    pathFor(provider, 'create'),
    { token },
    { signal: opts?.signal },
  )
  // 复用 validateConfirmResp — 两端 schema 同构, 同一份校验避免分叉.
  return validateConfirmResp(resp) as BindCreateResp
}

// ---- response validators -------------------------------------------------
// 强校验外部数据是 system boundary 通用原则; 这里同时把不合规字段早抛, 让
// UI 不需要处理半成品响应.

const KNOWN_METHODS: ReadonlySet<BindMethod> = new Set(['password', 'sms_otp'])

function validateBindInfo(resp: unknown): BindInfoResp {
  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid bind/info response')
  }
  const r = resp as Record<string, unknown>
  if (typeof r.name !== 'string') {
    throw new Error('Invalid bind/info: name must be string')
  }
  if (typeof r.masked_email !== 'string') {
    throw new Error('Invalid bind/info: masked_email must be string')
  }
  if (!Array.isArray(r.methods)) {
    throw new Error('Invalid bind/info: methods must be array')
  }
  const methods: BindMethod[] = []
  for (const m of r.methods) {
    if (typeof m === 'string' && KNOWN_METHODS.has(m as BindMethod)) {
      methods.push(m as BindMethod)
    }
  }
  const out: BindInfoResp = {
    masked_email: r.masked_email,
    name: r.name,
    methods,
  }
  // masked_phone 是 optional, 字段缺失与空串语义不同 (§3.7); 只在确为非空字符串时透传.
  if (typeof r.masked_phone === 'string' && r.masked_phone !== '') {
    out.masked_phone = r.masked_phone
  }
  if (typeof r.support_contact === 'string' && r.support_contact !== '') {
    out.support_contact = r.support_contact
  }
  // PR#93 扩展字段. 老后端不返时保持 undefined, BindPage 视为"无 create 入口".
  if (typeof r.allow_create === 'boolean') {
    out.allow_create = r.allow_create
  }
  if (typeof r.create_blocked === 'string') {
    // 强类型 narrow: 仅放行已知值, 未知值降级为 '' 防 UI 误判.
    out.create_blocked = KNOWN_CREATE_BLOCKED.has(r.create_blocked as BindCreateBlocked)
      ? (r.create_blocked as BindCreateBlocked)
      : ''
  }
  return out
}

function validateVerifyResp(
  resp: unknown,
  expected: 'verified' | 'sent',
): BindVerifyResp {
  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid bind/verify response')
  }
  const r = resp as Record<string, unknown>
  if (r.status !== expected) {
    throw new Error(`Invalid bind/verify response: status != ${expected}`)
  }
  return { status: expected }
}

function validateConfirmResp(resp: unknown): BindConfirmResp {
  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid bind/confirm response')
  }
  const r = resp as Record<string, unknown>
  if (r.status !== 'ok') {
    throw new Error('Invalid bind/confirm: status != ok')
  }
  if (typeof r.login_resp !== 'string' || r.login_resp === '') {
    throw new Error('Invalid bind/confirm: login_resp must be non-empty string')
  }
  if (typeof r.uid !== 'string' || r.uid === '') {
    throw new Error('Invalid bind/confirm: uid must be non-empty string')
  }
  return { status: 'ok', login_resp: r.login_resp, uid: r.uid }
}
