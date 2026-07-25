import type { Page, Route } from '@playwright/test'

// bind 后端响应的 scenario 套件. 每个 scenario 决定 5 个端点各自的状态码 + body.
// 不在 Playwright 之外定义后端 — 端到端测试要的就是"前端在各种后端返回下表现正确".

export type BindScenario =
  | 'happy_password'
  | 'happy_sms'
  | 'info_410'
  | 'info_empty_methods'
  | 'info_password_only'
  | 'verify_password_401'
  | 'verify_password_429'
  | 'confirm_409'
  // PR#93 create paths
  | 'happy_create'
  | 'create_disabled'
  | 'create_blocked_claims_incomplete'
  | 'create_blocked_manual_conflict'
  | 'create_only_no_verify'
  | 'create_422'
  | 'create_429'
  | 'create_409_manual'
  // PR #72 review fixes (B1, B2, W2)
  | 'confirm_429_terminal'
  | 'verify_password_409_advance'

interface EndpointResp {
  status: number
  body: object
}

interface ScenarioConfig {
  info: EndpointResp
  verify_password: EndpointResp
  verify_otp_send: EndpointResp
  verify_otp_check: EndpointResp
  confirm: EndpointResp
  create: EndpointResp
}

const STANDARD_INFO = {
  masked_email: 'a***@example.com',
  masked_phone: '****5678',
  name: 'Alice',
  methods: ['password', 'sms_otp'],
  support_contact: 'support@example.com',
}

const STANDARD_LOGIN_RESP = JSON.stringify({
  uid: 'u-12345',
  token: 'tok-abc',
  app_id: 'app1',
  short_no: '0001',
  name: 'Alice',
  sex: 0,
})

// 把 /bind/create 也填一份默认值, 老 scenarios 不显示 create 按钮 (info 不返
// allow_create), 这个 endpoint 永远不会被命中, 安全.
const NEVER_HIT: EndpointResp = { status: 500, body: { msg: 'should_not_be_hit_in_this_scenario' } }

// 主创建 happy path 用的 info shape: allow_create=true + create_blocked=''
const CREATE_INFO = {
  ...STANDARD_INFO,
  allow_create: true,
  create_blocked: '',
}

const SCENARIOS: Record<BindScenario, ScenarioConfig> = {
  happy_password: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-12345' },
    },
    create: NEVER_HIT,
  },
  happy_sms: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-12345' },
    },
    create: NEVER_HIT,
  },
  info_410: {
    info: { status: 410, body: { msg: 'expired' } },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  info_empty_methods: {
    info: { status: 200, body: { ...STANDARD_INFO, methods: [] } },
    verify_password: { status: 200, body: {} },
    verify_otp_send: { status: 200, body: {} },
    verify_otp_check: { status: 200, body: {} },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  info_password_only: {
    info: { status: 200, body: { ...STANDARD_INFO, methods: ['password'] } },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: {} },
    verify_otp_check: { status: 200, body: {} },
    confirm: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-12345' },
    },
    create: NEVER_HIT,
  },
  verify_password_401: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 401, body: { msg: 'invalid_credential' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  verify_password_429: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 429, body: { msg: 'rate_limited' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  confirm_409: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 409, body: { msg: 'already_bound' } },
    create: NEVER_HIT,
  },
  // ----- PR#93 create paths -----------------------------------------------
  happy_create: {
    info: { status: 200, body: CREATE_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-new-99' },
    },
  },
  create_disabled: {
    // allow_create=false 时 verify 路径仍可用, 用户走老 UX
    info: {
      status: 200,
      body: { ...STANDARD_INFO, allow_create: false, create_blocked: 'disabled' },
    },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-12345' },
    },
    create: NEVER_HIT,
  },
  create_blocked_claims_incomplete: {
    // allow_create=true 但 claims 缺验证邮箱/手机, 显示阻塞文案
    info: {
      status: 200,
      body: { ...STANDARD_INFO, allow_create: true, create_blocked: 'claims_incomplete' },
    },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  create_blocked_manual_conflict: {
    info: {
      status: 200,
      body: { ...STANDARD_INFO, allow_create: true, create_blocked: 'manual_conflict' },
    },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: NEVER_HIT,
  },
  create_only_no_verify: {
    // methods=[] 但 create 可用 — 应该进 choose_method 而不是 fatal
    info: {
      status: 200,
      body: { ...STANDARD_INFO, methods: [], allow_create: true, create_blocked: '' },
    },
    verify_password: { status: 200, body: {} },
    verify_otp_send: { status: 200, body: {} },
    verify_otp_check: { status: 200, body: {} },
    confirm: { status: 200, body: {} },
    create: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-new-only' },
    },
  },
  create_422: {
    info: { status: 200, body: CREATE_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: { status: 422, body: { msg: 'claims missing required fields' } },
  },
  create_429: {
    info: { status: 200, body: CREATE_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: { status: 429, body: { msg: 'too many create attempts' } },
  },
  create_409_manual: {
    info: { status: 200, body: CREATE_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 200, body: {} },
    create: { status: 409, body: { msg: 'account conflict needs manual resolution' } },
  },
  // PR #72 review B1 regression: confirm 429 must NOT leave the user on an
  // infinite spinner — flow goes verify OK → confirming → 429 → fatal.
  confirm_429_terminal: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 200, body: { status: 'verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: { status: 429, body: { msg: 'rate_limited' } },
    create: NEVER_HIT,
  },
  // PR #72 review W2 regression: verify_password 409 must auto-advance to
  // confirm (token already verified server-side) instead of stranding user
  // with an inline "请继续完成绑定" message and no action.
  verify_password_409_advance: {
    info: { status: 200, body: STANDARD_INFO },
    verify_password: { status: 409, body: { msg: 'already_verified' } },
    verify_otp_send: { status: 200, body: { status: 'sent' } },
    verify_otp_check: { status: 200, body: { status: 'verified' } },
    confirm: {
      status: 200,
      body: { status: 'ok', login_resp: STANDARD_LOGIN_RESP, uid: 'u-12345' },
    },
    create: NEVER_HIT,
  },
}

const PATH_MATCHERS: Array<{ test: RegExp; key: keyof ScenarioConfig }> = [
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/info(\?|$)/, key: 'info' },
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/verify\/password(\?|$)/, key: 'verify_password' },
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/verify\/otp\/send(\?|$)/, key: 'verify_otp_send' },
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/verify\/otp\/check(\?|$)/, key: 'verify_otp_check' },
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/confirm(\?|$)/, key: 'confirm' },
  { test: /\/v1\/auth\/oidc\/[^/]+\/bind\/create(\?|$)/, key: 'create' },
]

/**
 * mockBindServer 把 5 个 bind 端点全部拦截, 按 scenario 返回. 同时记录每次调用
 * 让测试断言端点被命中以及请求体格式正确 (e.g. otp/send 不带 phone, password
 * 体含 identifier+password 等).
 *
 * Vite dev server 在 /api 路径下做了 proxy 转发后端; 但 bind 端点用的是绝对路径
 * /v1/auth/oidc/... (见 oidc/api.ts:AUTHCODE_PATH 同侧路径设计), 走的是 vite
 * 默认 fallback. 这里 page.route 用 glob "(STAR)(STAR)/v1/auth/oidc/(STAR)(STAR)" 匹配 (STAR=*).
 */
export async function mockBindServer(
  page: Page,
  scenario: BindScenario,
): Promise<{ calls: { endpoint: keyof ScenarioConfig; body?: unknown; url: string }[] }> {
  const config = SCENARIOS[scenario]
  const calls: { endpoint: keyof ScenarioConfig; body?: unknown; url: string }[] = []

  await page.route('**/v1/auth/oidc/**', async (route: Route) => {
    const url = route.request().url()
    const matcher = PATH_MATCHERS.find((m) => m.test.test(url))
    if (!matcher) return route.continue()
    const ep = matcher.key
    let body: unknown
    try {
      const postData = route.request().postData()
      body = postData ? JSON.parse(postData) : undefined
    } catch {
      body = undefined
    }
    calls.push({ endpoint: ep, body, url })
    const resp = config[ep]
    await route.fulfill({
      status: resp.status,
      contentType: 'application/json',
      body: JSON.stringify(resp.body),
    })
  })

  return { calls }
}

/**
 * gotoBindPage 用 query 形式打开 /oidc/bind. token / authcode / return_to /
 * provider 都从这里注入. 默认值反映"后端 redirect 标准 payload".
 */
export async function gotoBindPage(
  page: Page,
  opts: {
    token?: string
    authcode?: string
    returnTo?: string
    provider?: string
  } = {},
): Promise<void> {
  // Placeholder token for e2e mocking only — never a real credential.
  const token = opts.token ?? 'MOCK_TOKEN_PLACEHOLDER_e2e_default'
  const authcode = opts.authcode ?? 'ac-fe-12345'
  const returnTo = opts.returnTo ?? '/'
  const provider = opts.provider ?? 'aegis'
  const qs = new URLSearchParams({
    token,
    authcode,
    return_to: returnTo,
    provider,
  })
  await page.goto(`/oidc/bind?${qs.toString()}`)
}
