import { test, expect } from '@playwright/test'
import { installMswScenario } from '../../_lib/mswScenario'
import { mockBindServer, gotoBindPage } from './fixtures/mockBindServer'

// Placeholder value used only for e2e mocking — never a real credential.
// Renamed from a `tok-*` prefix to avoid gitleaks false positive.
const TOKEN = 'MOCK_TOKEN_PLACEHOLDER_e2e_only'

// 关闭 WKRemoteConfig 网络抖动: 这些请求与 bind 流程无关, 真实跑会被 vite proxy
// 502 干扰日志. 让它们落空, 测试更稳.
test.beforeEach(async ({ page }) => {
  // kit MSW 层让路 (scenario=no-mock 让 baseline handler passthrough).
  // bind 用 page.route 自己精确 mock 每种状态码, 不需要 kit 打扰.
  await installMswScenario(page, 'no-mock')

  await page.route('**/api/v1/common/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ oidc_providers: [] }),
    }),
  )
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
  // 清登录态 + 锁 locale=zh-CN (spec 断言中文文案, 依赖 navigator locale 不稳).
  // 上一个测试残留可能把 BindPage 跳过, 必须清.
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('octo:locale', 'zh-CN')
    } catch {
      /* noop */
    }
  })
})

test.describe('OIDC bind page', () => {
  test('happy path - password verifies and confirms then navigates to return_to', async ({ page }) => {
    const { calls } = await mockBindServer(page, 'happy_password')
    await gotoBindPage(page, { token: TOKEN, returnTo: '/contacts' })

    // 渲染脱敏身份块
    await expect(page.getByText('完成账号绑定')).toBeVisible()
    await expect(page.getByText('a***@example.com')).toBeVisible()
    await expect(page.getByText('****5678')).toBeVisible()

    // 选 password
    await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
    await page.getByLabel(/Octo 账号/).fill('alice')
    await page.locator('#bind-password').fill('pw-correct')
    await page.getByRole('button', { name: '验证并绑定' }).click()

    // confirm 调用后 BindPage 200ms 内 setTimeout 跳转, 等到 URL 变化
    await page.waitForURL((u) => u.pathname === '/contacts', { timeout: 5000 })

    const verifyCall = calls.find((c) => c.endpoint === 'verify_password')
    expect(verifyCall?.body).toMatchObject({
      token: TOKEN,
      identifier: 'alice',
      password: 'pw-correct',
    })
    expect(calls.find((c) => c.endpoint === 'confirm')?.body).toMatchObject({
      token: TOKEN,
    })
  })

  test('happy path - sms_otp sends, verifies and confirms', async ({ page }) => {
    const { calls } = await mockBindServer(page, 'happy_sms')
    await gotoBindPage(page, { token: TOKEN, returnTo: '/' })

    await page.getByRole('button', { name: '使用短信验证码验证' }).click()
    // 用 OTP 输入框作为"发送完成"的稳定信号; Toast 与内联提示文案重叠会触发 strict 冲突.
    await expect(page.locator('#bind-otp')).toBeVisible()
    // /otp/send 不能带 phone (隐私 + 防号码探测)
    const sendCall = calls.find((c) => c.endpoint === 'verify_otp_send')
    expect(sendCall?.body).toEqual({ token: TOKEN })

    await page.locator('#bind-otp').fill('123456')
    await page.getByRole('button', { name: '验证并绑定' }).click()
    await page.waitForURL((u) => u.pathname === '/', { timeout: 5000 })

    const checkCall = calls.find((c) => c.endpoint === 'verify_otp_check')
    expect(checkCall?.body).toMatchObject({ token: TOKEN, code: '123456' })
  })

  test('token safety: URL is cleaned and token never appears in DOM or window globals', async ({ page }) => {
    await mockBindServer(page, 'happy_password')
    await gotoBindPage(page, { token: TOKEN })

    // 等到信息加载完毕才检查, 确保 clearBindUrl 已经跑过且后续渲染没把 token 写进 DOM.
    await expect(page.getByText('Alice')).toBeVisible()

    // 1) URL bind-flow params must be wiped, but non-bind params (sid in
    // particular — used by LoginInfo storage bucket selection) must survive.
    // Updated for PR #72 round-3 fix where clearBindUrl preserves sid.
    const url = new URL(page.url())
    expect(url.pathname).toBe('/oidc/bind')
    const params = new URLSearchParams(url.search)
    expect(params.has('token')).toBe(false)
    expect(params.has('authcode')).toBe(false)
    expect(params.has('return_to')).toBe(false)
    expect(params.has('provider')).toBe(false)
    expect(url.search).not.toContain(TOKEN)

    // 2) 渲染出的 HTML 不能包含 token 字面值
    const html = await page.content()
    expect(html).not.toContain(TOKEN)

    // 3) window 上不能挂带 token 的字段; 包括前端契约要求的埋点钩子不能落 token
    const leaked = await page.evaluate((tok) => {
      const keys = Object.keys(window as unknown as Record<string, unknown>)
      const found: string[] = []
      for (const k of keys) {
        try {
          const v = (window as unknown as Record<string, unknown>)[k]
          if (typeof v === 'string' && v.includes(tok)) found.push(k)
        } catch {
          /* skip prop access errors */
        }
      }
      return found
    }, TOKEN)
    expect(leaked).toEqual([])
  })

  test('info 410 falls to fatal stage with "重新登录" CTA', async ({ page }) => {
    await mockBindServer(page, 'info_410')
    await gotoBindPage(page, { token: TOKEN })

    await expect(page.getByText('链接已过期，请重新发起登录')).toBeVisible()
    await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
  })

  test('verify_password 401 shows inline error and lets user retry', async ({ page }) => {
    await mockBindServer(page, 'verify_password_401')
    await gotoBindPage(page, { token: TOKEN })

    await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
    await page.getByLabel(/Octo 账号/).fill('alice')
    await page.locator('#bind-password').fill('wrong-pw')
    await page.getByRole('button', { name: '验证并绑定' }).click()

    await expect(page.getByText('用户名或密码错误')).toBeVisible()
    // 仍在 verify_password 阶段, 表单仍可见, 不要跳 fatal
    await expect(page.locator('#bind-password')).toBeVisible()
  })

  test('verify_password 429 shows rate-limit copy non-terminal', async ({ page }) => {
    await mockBindServer(page, 'verify_password_429')
    await gotoBindPage(page, { token: TOKEN })

    await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
    await page.getByLabel(/Octo 账号/).fill('alice')
    await page.locator('#bind-password').fill('pw')
    await page.getByRole('button', { name: '验证并绑定' }).click()

    await expect(page.getByText('尝试次数过多，请稍后再试')).toBeVisible()
    await expect(page.locator('#bind-password')).toBeVisible()
  })

  test('confirm 409 (identity already bound) shows terminal copy guiding back to login', async ({ page }) => {
    await mockBindServer(page, 'confirm_409')
    await gotoBindPage(page, { token: TOKEN })

    await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
    await page.getByLabel(/Octo 账号/).fill('alice')
    await page.locator('#bind-password').fill('pw')
    await page.getByRole('button', { name: '验证并绑定' }).click()

    await expect(page.getByText(/该账号已绑定/)).toBeVisible()
    await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
  })

  test('methods=[password] hides SMS button (dynamic rendering)', async ({ page }) => {
    await mockBindServer(page, 'info_password_only')
    await gotoBindPage(page, { token: TOKEN })

    await expect(page.getByRole('button', { name: '使用 Octo 密码验证' })).toBeVisible()
    await expect(page.getByRole('button', { name: '使用短信验证码验证' })).toHaveCount(0)
  })

  test('methods=[] falls to fatal with support_contact', async ({ page }) => {
    await mockBindServer(page, 'info_empty_methods')
    await gotoBindPage(page, { token: TOKEN })

    await expect(page.getByText(/无可用的绑定方式/)).toBeVisible()
    await expect(page.getByText('support@example.com')).toBeVisible()
  })

  // ============ PR#93: /bind/create paths ===================================
  test.describe('create from SSO (PR#93)', () => {
    test('happy create: primary button → POST /bind/create → navigate', async ({ page }) => {
      const { calls } = await mockBindServer(page, 'happy_create')
      await gotoBindPage(page, { token: TOKEN, returnTo: '/contacts' })

      // 主按钮可见且可点
      const createBtn = page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' })
      await expect(createBtn).toBeVisible()
      // verify 路径作为次入口仍存在 (但视觉降级)
      await expect(page.getByRole('button', { name: '使用 Octo 密码验证' })).toBeVisible()
      // 引导文案根据 methods[] 动态生成 (这里 happy_create 给的是 ['password','sms_otp'])
      await expect(page.getByText('已有 Octo 账号，使用密码或短信验证关联')).toBeVisible()

      await createBtn.click()
      await page.waitForURL((u) => u.pathname === '/contacts', { timeout: 5000 })

      const createCall = calls.find((c) => c.endpoint === 'create')
      expect(createCall?.body).toEqual({ token: TOKEN })
      // 不应该顺手打 confirm — 走的是独立的 create 端点
      expect(calls.find((c) => c.endpoint === 'confirm')).toBeUndefined()
    })

    test('create disabled: button hidden, verify methods remain primary', async ({ page }) => {
      await mockBindServer(page, 'create_disabled')
      await gotoBindPage(page, { token: TOKEN })

      // 主创建按钮不渲染
      await expect(page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' })).toHaveCount(0)
      // verify 路径仍然在
      await expect(page.getByRole('button', { name: '使用 Octo 密码验证' })).toBeVisible()
      // 没有引导文案 (因为没有主路径)
      await expect(page.getByText('已有 Octo 账号，使用密码或短信验证关联')).toHaveCount(0)
    })

    test('create blocked - claims_incomplete: show reason, hide button, verify still usable', async ({
      page,
    }) => {
      await mockBindServer(page, 'create_blocked_claims_incomplete')
      await gotoBindPage(page, { token: TOKEN })

      await expect(page.getByText(/SSO 身份信息不完整/)).toBeVisible()
      await expect(page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '使用 Octo 密码验证' })).toBeVisible()
    })

    test('create blocked - manual_conflict: show admin-contact hint', async ({ page }) => {
      await mockBindServer(page, 'create_blocked_manual_conflict')
      await gotoBindPage(page, { token: TOKEN })

      await expect(page.getByText(/匹配到多个 Octo 账号/)).toBeVisible()
      await expect(page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' })).toHaveCount(0)
    })

    test('methods=[] + create available: choose_method (NOT fatal)', async ({ page }) => {
      await mockBindServer(page, 'create_only_no_verify')
      await gotoBindPage(page, { token: TOKEN })

      // 应该看到主创建按钮, NOT fatal "无可用的绑定方式"
      await expect(page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' })).toBeVisible()
      await expect(page.getByText(/无可用的绑定方式/)).toHaveCount(0)
      // verify 按钮也不应该出现
      await expect(page.getByRole('button', { name: '使用 Octo 密码验证' })).toHaveCount(0)
    })

    test('create 422 (claims incomplete at create time) → fatal terminal', async ({ page }) => {
      await mockBindServer(page, 'create_422')
      await gotoBindPage(page, { token: TOKEN })

      await page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' }).click()
      await expect(page.getByText(/SSO 身份信息不完整|无法自助创建/)).toBeVisible()
      await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
    })

    test('create 429 (max=1) → fatal "请重新发起 SSO 登录"', async ({ page }) => {
      await mockBindServer(page, 'create_429')
      await gotoBindPage(page, { token: TOKEN })

      await page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' }).click()
      await expect(page.getByText(/已尝试创建|重新发起 SSO/)).toBeVisible()
      await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
    })

    test('create 409 (manual conflict) → fatal "联系管理员"', async ({ page }) => {
      await mockBindServer(page, 'create_409_manual')
      await gotoBindPage(page, { token: TOKEN })

      await page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' }).click()
      await expect(page.getByText(/账号信息冲突|联系管理员/)).toBeVisible()
      await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
    })
  })

  // PR #72 reviewer regressions ===========================================
  test.describe('PR #72 review fixes', () => {
    test('B1: confirm 429 surfaces fatal screen, not infinite spinner', async ({ page }) => {
      await mockBindServer(page, 'confirm_429_terminal')
      await gotoBindPage(page, { token: TOKEN })

      // Drive verify → confirm → 429 path
      await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
      await page.getByLabel(/Octo 账号/).fill('alice')
      await page.locator('#bind-password').fill('pw-correct')
      await page.getByRole('button', { name: '验证并绑定' }).click()

      // Must reach a fatal screen with a recovery button — not stuck on spinner.
      await expect(page.getByRole('button', { name: '返回登录' })).toBeVisible()
      await expect(page.getByText(/重新发起 SSO|绑定失败/)).toBeVisible()
    })

    test('W2: verify_password 409 auto-advances to confirm (no inline dead-end)', async ({ page }) => {
      const { calls } = await mockBindServer(page, 'verify_password_409_advance')
      await gotoBindPage(page, { token: TOKEN, returnTo: '/' })

      await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
      await page.getByLabel(/Octo 账号/).fill('alice')
      await page.locator('#bind-password').fill('pw-correct')
      await page.getByRole('button', { name: '验证并绑定' }).click()

      // verify returned 409 → BindPage should call confirm anyway and navigate.
      await page.waitForURL((u) => u.pathname === '/', { timeout: 5000 })
      expect(calls.find((c) => c.endpoint === 'verify_password')).toBeDefined()
      expect(calls.find((c) => c.endpoint === 'confirm')).toBeDefined()
    })

    // runConfirm / runCreate must persist the real IdP id into
    // WKApp.loginInfo.loginProvider (= the URL ?provider= value, or
    // FALLBACK_PROVIDER_ID when omitted) — NOT a synthetic 'oidc-bind' /
    // 'oidc-bind-create' label. Downstream NavSettingsPanel +
    // realnameVerifyUrl + login.tsx reset-password all do
    // providers.find(p => p.id === loginProvider) and would fail closed on
    // the synthetic value.
    //
    // Why we assert via sessionStorage (not localStorage): LoginInfo.save()
    // routes through StorageService.shared.setItem (sessionStorage primary,
    // localStorage only for the cross-tab whitelist token/uid/short_no/app_id/
    // name/role/is_work/sex — login_provider is NOT in that whitelist, so it
    // lives in sessionStorage only). See StorageService.tsx:1-31.
    //
    // Why we stub window.location.replace: finalizeBindSuccess schedules a
    // location.replace(returnTo) ~200ms after save(). The outer beforeEach
    // installs addInitScript clearing session+localStorage on every navigation,
    // including that post-bind reload — so a naive read after waitForURL gets
    // null. Stubbing replace lets save() persist while keeping us on /oidc/bind
    // so the cleared-on-next-init storage stays intact.
    async function readLoginProviderFromSession(
      page: import('@playwright/test').Page,
    ): Promise<string | null> {
      // setStorageItemForSID writes 'login_provider' + sid, where sid comes
      // from the live URL's ?sid= (LoginInfo.getSID, App.tsx:343). RouteManager
      // injects sid on pageshow, so we read it back from the URL at assertion
      // time rather than hardcoding.
      return page.evaluate(() => {
        const sid = new URLSearchParams(window.location.search).get('sid') ?? ''
        return sessionStorage.getItem('login_provider' + sid)
      })
    }

    async function stubLocationReplace(page: import('@playwright/test').Page): Promise<void> {
      await page.evaluate(() => {
        // Replace the method, not the whole location object (the latter is a
        // browser-protected accessor and can't be reassigned in Chromium).
        const noop = (): void => {
          /* swallow navigation so storage observations stay on /oidc/bind */
        }
        try {
          Object.defineProperty(window.location, 'replace', {
            configurable: true,
            value: noop,
          })
        } catch {
          /* fallback: best-effort overwrite */
          ;(window.location as unknown as { replace: () => void }).replace = noop
        }
      })
    }

    test('loginProvider persists URL ?provider= on confirm (not synthetic "oidc-bind")', async ({ page }) => {
      await mockBindServer(page, 'happy_password')
      await gotoBindPage(page, { token: TOKEN, returnTo: '/', provider: 'xming' })
      await stubLocationReplace(page)

      await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
      await page.getByLabel(/Octo 账号/).fill('alice')
      await page.locator('#bind-password').fill('pw-correct')
      await page.getByRole('button', { name: '验证并绑定' }).click()

      // Wait for the success stage — by the time '绑定成功' renders, save() has
      // already run synchronously in runConfirm just before finalizeBindSuccess.
      await expect(page.getByText('绑定成功，正在跳转…')).toBeVisible()

      // Storage key is 'login_provider' + sid. RouteManager's pageshow handler
      // injects ?sid=... into /oidc/bind, and LoginInfo.setStorageItemForSID
      // suffixes the sid onto every key so different tabs/sessions don't
      // collide. Derive sid from the live URL rather than hardcoding.
      const persisted = await readLoginProviderFromSession(page)
      expect(persisted).toBe('xming')
      expect(persisted).not.toBe('oidc-bind')
    })

    test('loginProvider falls back to FALLBACK_PROVIDER_ID when URL omits ?provider=', async ({ page }) => {
      await mockBindServer(page, 'happy_password')
      // Inline-build URL to omit provider (gotoBindPage defaults to 'aegis').
      const qs = new URLSearchParams({
        token: TOKEN,
        authcode: 'ac-fe-12345',
        return_to: '/',
      })
      await page.goto(`/oidc/bind?${qs.toString()}`)
      await stubLocationReplace(page)

      await page.getByRole('button', { name: '使用 Octo 密码验证' }).click()
      await page.getByLabel(/Octo 账号/).fill('alice')
      await page.locator('#bind-password').fill('pw-correct')
      await page.getByRole('button', { name: '验证并绑定' }).click()

      await expect(page.getByText('绑定成功，正在跳转…')).toBeVisible()

      const persisted = await readLoginProviderFromSession(page)
      // FALLBACK_PROVIDER_ID is 'aegis' (api.ts:24). Keep the literal here to
      // catch accidental changes to the fallback contract.
      expect(persisted).toBe('aegis')
      expect(persisted).not.toBe('oidc-bind')
    })

    // The token must not survive in the Back stack. Earlier rounds only
    // verified the *current* URL was scrubbed, but RouteManager's pageshow
    // handler push()s a new sid entry on top of the original token-bearing
    // one (Route.tsx:48), and clearBindUrl in BindPage only replaces the
    // *current* entry — so the token URL stays in history. BindModule.init
    // does a synchronous history.replaceState before pageshow fires to fix
    // this. Regression below navigates from a non-bind URL into
    // /oidc/bind?token=, then walks the Back stack asserting no entry exposes
    // the token.
    test('history Back does not expose bind token', async ({ page }) => {
      await mockBindServer(page, 'happy_password')
      // Seed the history with a non-bind URL so the bind entry has somewhere
      // to go Back to. '/' resolves under the dev server's vite root.
      await page.goto('/')
      await gotoBindPage(page, { token: TOKEN })
      // Wait until BindPage rendered — proves init() + the cleanup ran.
      await expect(page.getByText('Alice')).toBeVisible()

      // Current URL must already be clean (existing invariant, kept here so
      // the regression localizes the failure).
      expect(page.url()).not.toContain(TOKEN)

      // Walk the entire Back stack and assert no entry contains the token.
      // Without the BindModule.init replaceState, the original
      // `/oidc/bind?token=…` entry sits between the seed `/` and the
      // RouteManager-pushed `/oidc/bind?sid=…` — goBack would land on it.
      //
      // RouteManager's popstate handler will pushState a sid URL on top of
      // whatever the browser navigates back to, so we sample page.url()
      // *immediately* after goBack (before further script work) AND read
      // window.history.length to bound the walk. waitForLoadState('load')
      // ensures the popstate-triggered work has settled.
      for (let i = 0; i < 5; i += 1) {
        const before = page.url()
        expect(before).not.toContain(TOKEN)
        const canGoBack = await page.evaluate(() => window.history.length > 1)
        if (!canGoBack) break
        const navigated = await page.goBack().catch(() => null)
        if (navigated === null) break
        await page.waitForLoadState('load').catch(() => undefined)
        expect(page.url()).not.toContain(TOKEN)
        if (page.url() === before) break // popstate looped — stop
      }
    })

    test('loginProvider persists URL ?provider= on create (not synthetic "oidc-bind-create")', async ({ page }) => {
      await mockBindServer(page, 'happy_create')
      await gotoBindPage(page, { token: TOKEN, returnTo: '/', provider: 'xming' })
      await stubLocationReplace(page)

      await page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' }).click()
      await expect(page.getByText('绑定成功，正在跳转…')).toBeVisible()

      const persisted = await readLoginProviderFromSession(page)
      expect(persisted).toBe('xming')
      expect(persisted).not.toBe('oidc-bind-create')
    })

    test('R4: bind/create with pendingInviteCode hands off to AppLayout invite-join flow', async ({ page }) => {
      await mockBindServer(page, 'happy_create')

      // Mock the two AppLayout.onLogin invite endpoints. mockBindServer only
      // intercepts /v1/auth/oidc/* so /api/v1/space/* falls through to be
      // handled here. Predicate route — Playwright's `**/api/v1/...` glob
      // matched inconsistently against the proxied URL; the URL-object
      // predicate is unambiguous and reads against the post-baseURL path.
      let inviteFetched = false
      let joinPosted = false
      await page.route((url) => url.pathname.startsWith('/api/v1/space/'), (route) => {
        const url = route.request().url()
        if (url.endsWith('/api/v1/space/invite/INVITE-XYZ')) {
          inviteFetched = true
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ space_id: 'space-1', space_name: 'Demo Space' }),
          })
        }
        if (url.endsWith('/api/v1/space/join')) {
          joinPosted = true
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'ok', space_id: 'space-1' }),
          })
        }
        return route.continue()
      })

      // Pre-seed localStorage like LoginVM.didMount would. Use page.evaluate
      // rather than addInitScript — the latter re-runs on every navigation,
      // including the post-bind /space/join → goMain reload, which would
      // immediately re-set the key after AppLayout.onLogin's .then cleared it.
      // returnTo=/contacts to prove the invite path overrides it.
      await gotoBindPage(page, { token: TOKEN, returnTo: '/contacts' })
      await page.evaluate(() => {
        localStorage.setItem('pendingInviteCode', 'INVITE-XYZ')
      })

      await page.getByRole('button', { name: '使用 SSO 身份创建 Octo 账号' }).click()
      // Give AppLayout.onLogin's fetch chain time to issue both calls and run
      // the .then localStorage cleanup.
      await page.waitForTimeout(800)

      expect(inviteFetched).toBe(true)
      expect(joinPosted).toBe(true)

      // pendingInviteCode is cleared inside the /space/join .then in AppLayout
      // (apps/web/src/Layout/index.tsx). Poll because the cleanup runs after
      // the mocked response resolves, not synchronously with the request.
      await expect.poll(
        async () => page.evaluate(() => localStorage.getItem('pendingInviteCode')),
        { timeout: 3000 },
      ).toBeNull()
    })
  })
})
