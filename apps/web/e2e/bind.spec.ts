import { test, expect } from '@playwright/test'
import { mockBindServer, gotoBindPage } from './fixtures/mockBindServer'

const TOKEN = 'tok-secret-do-not-leak-xyz789'

// 关闭 WKRemoteConfig 网络抖动: 这些请求与 bind 流程无关, 真实跑会被 vite proxy
// 502 干扰日志. 让它们落空, 测试更稳.
test.beforeEach(async ({ page }) => {
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
  // 清登录态, 避免上一个测试残留把 BindPage 跳过.
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
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

    // 1) URL 的 query 段应被 replaceState 清空
    const url = new URL(page.url())
    expect(url.search).toBe('')
    expect(url.pathname).toBe('/oidc/bind')

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
  })
})
