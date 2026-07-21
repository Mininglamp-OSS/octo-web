import { test, expect, type Page, type Route } from '@playwright/test'
import { installMswScenario } from '../../_lib/mswScenario'

/**
 * Standalone doc page (`/d/:docId`) — clean cold-load end-to-end (octo-web #512 / XIN-294).
 *
 * The tester's real-machine run (XIN-293) passed every AC reached via the in-app sid route but
 * failed 6 on a clean cold-load (a shared link opened in a fresh tab, no `?sid=`): the direct path
 * was not self-sufficient. These specs drive a REAL browser straight at `/d/:docId` with the
 * backend mocked per status code, so the clean path is exercised without any in-app navigation —
 * exactly the scenario the 447 green component unit tests never covered.
 *
 * Auth model under test: a signed-in user's session lives under a `token{sid}` bucket in
 * localStorage; a fresh-tab deep-link URL has no `?sid=`, so the app must recover that session
 * from storage (AC-3). A genuinely anonymous visitor must fall through to the login screen so the
 * post-login bounce returns them to the doc (AC-11).
 */

// kit MSW 层让路: 本 spec 用 page.route 自己精确 mock 各 status code.
test.beforeEach(async ({ page }) => {
  await installMswScenario(page, 'no-mock')
})

const SID = 'S_e2e'
// Placeholder value used only for e2e mocking — never a real credential.
// Renamed from a `tok-*` prefix to avoid gitleaks false positive.
const USER_TOKEN = 'MOCK_USER_TOKEN_PLACEHOLDER_e2e_only'

/** Silence unrelated boot traffic and default every backend call to an innocuous 200 {}. */
async function stubBackend(page: Page): Promise<void> {
  await page.route('**/api/v1/common/**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ oidc_providers: [] }),
    }),
  )
  await page.route('**/api/v1/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
}

/** Route the per-doc preflight (GET /api/v1/docs/:id) to a specific status/body. */
async function routeDocPreflight(
  page: Page,
  docId: string,
  status: number,
  body: object = {},
): Promise<{ tokenHeaderOf: () => string | undefined }> {
  let seenToken: string | undefined
  await page.route(`**/api/v1/docs/${docId}`, (route: Route) => {
    seenToken = route.request().headers()['token']
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return { tokenHeaderOf: () => seenToken }
}

/** Seed a signed-in session under a sid bucket, as if the user logged in earlier in another tab. */
async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(
    ([sid, token]) => {
      try {
        localStorage.clear()
        sessionStorage.clear()
        localStorage.setItem('token' + sid, token)
        localStorage.setItem('uid' + sid, 'u_e2e')
        localStorage.setItem('name' + sid, 'E2E User')
      } catch {
        /* noop */
      }
    },
    [SID, USER_TOKEN],
  )
}

/** Clear all storage → a genuinely anonymous visitor. */
async function seedAnonymous(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* noop */
    }
  })
}

test.describe('standalone /d/:docId — clean cold-load (no in-app sid route)', () => {
  test('AC-3: a signed-in user opening a clean link authenticates the preflight (no 401 wall)', async ({
    page,
  }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    const probe = await routeDocPreflight(page, 'd_ok', 200, {
      docId: 'd_ok',
      title: 'Shared Doc',
      ownerId: 'u_e2e',
      role: 'admin',
    })

    // Fresh-tab deep link: NO ?sid= in the URL.
    await page.goto('/d/d_ok')

    // The recovered session token rides the preflight — not an anonymous 401-bound request.
    await expect.poll(() => probe.tokenHeaderOf()).toBe(USER_TOKEN)
    // The clean path did NOT dead-end on the sign-in terminal.
    await expect(page.locator('.octo-terminal-msg')).toHaveCount(0)
  })

  test('AC-7: a 403 renders the access-denied terminal with a Back control, editor not mounted', async ({
    page,
  }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    await routeDocPreflight(page, 'd_forbidden', 403)

    await page.goto('/d/d_forbidden')

    await expect(page.locator('.octo-terminal')).toBeVisible()
    await expect(page.locator('.octo-terminal-msg')).toHaveText(/no longer have access|无权访问/)
    await expect(page.locator('.octo-doc-back')).toBeVisible()
    await expect(page.locator('.octo-doc--editor')).toHaveCount(0)
  })

  test('AC-12: an archived doc (409) renders the locked terminal', async ({ page }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    await routeDocPreflight(page, 'd_archived', 409)

    await page.goto('/d/d_archived')

    await expect(page.locator('.octo-terminal')).toBeVisible()
    await expect(page.locator('.octo-terminal-msg')).toHaveText(/locked or archived|锁定或归档/)
    await expect(page.locator('.octo-doc--editor')).toHaveCount(0)
  })

  test('AC-10/9: a 404 renders the not-found terminal', async ({ page }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    await routeDocPreflight(page, 'd_missing', 404)

    await page.goto('/d/d_missing')

    await expect(page.locator('.octo-terminal')).toBeVisible()
    await expect(page.locator('.octo-terminal-msg')).toHaveText(/does not exist|不存在/)
  })

  test('AC-9: a malformed id (`/d/` empty) renders not-found without any preflight, never the shell', async ({
    page,
  }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    let preflightCalls = 0
    await page.route('**/api/v1/docs/**', (route: Route) => {
      preflightCalls += 1
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    // `/d/` with no id is still the standalone namespace — must be intercepted, not shelled.
    await page.goto('/d/')

    await expect(page.locator('.octo-terminal')).toBeVisible()
    await expect(page.locator('.octo-terminal-msg')).toHaveText(/does not exist|不存在/)
    // The app shell (NavRail) must NOT appear.
    await expect(page.locator('.wk-nav-rail, .octo-nav-rail')).toHaveCount(0)
    expect(preflightCalls).toBe(0)
  })

  test('AC-11: an anonymous visitor is sent to the login screen (so post-login bounces back)', async ({
    page,
  }) => {
    await seedAnonymous(page)
    await stubBackend(page)
    // Even if a preflight were issued it would 401; the point is the app renders login, not a
    // standalone dead-end.
    await routeDocPreflight(page, 'd_shared', 401)

    await page.goto('/d/d_shared')

    // The login screen renders in place (pathname stays /d/d_shared → onLogin bounces back).
    await expect(page.locator('[class^="wk-login"], [class*=" wk-login"]').first()).toBeVisible()
    await expect(page.locator('.octo-doc-standalone')).toHaveCount(0)
  })
})

test.describe('standalone /d/:docId — records a view in the viewer space (XIN-1238)', () => {
  test('opening a cross-space share link fires POST /docs/:id/view with X-Space-Id = viewer current space, not the doc space', async ({
    page,
  }) => {
    await seedSignedInSession(page)
    // The viewer is currently in `space-viewer`; the shell persists that under the shared
    // `currentSpaceId` key. On a cold `/d/:docId` deep link this is the only source of the viewer's
    // real space (the live space is not yet restored).
    await page.addInitScript(() => {
      try {
        localStorage.setItem('currentSpaceId', 'space-viewer')
      } catch {
        /* noop */
      }
    })
    await stubBackend(page)
    // Cross-space share: the link carries the DOC's own space (`?sp=space-doc`), which the page uses
    // to address the preflight — deliberately different from the viewer's current space.
    await routeDocPreflight(page, 'd_ok', 200, {
      docId: 'd_ok',
      title: 'Shared Doc',
      ownerId: 'u_owner',
      role: 'reader',
    })

    // Capture the view-ingest call. Registered after the catch-all so it wins (Playwright runs the
    // most-recently-added matching handler first).
    let viewSpaceHeader: string | undefined
    let viewCalls = 0
    await page.route('**/api/v1/docs/d_ok/view', (route: Route) => {
      viewCalls += 1
      viewSpaceHeader = route.request().headers()['x-space-id']
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/d/d_ok?sp=space-doc')

    // The view was recorded once, addressed to the VIEWER's current space so it surfaces in the
    // viewer's 最近查看 (XIN-1237 write/read contract) — NOT the doc's own space.
    await expect.poll(() => viewCalls).toBe(1)
    expect(viewSpaceHeader).toBe('space-viewer')
  })

  test('does not record a view when the preflight fails to a terminal (403)', async ({ page }) => {
    await seedSignedInSession(page)
    await stubBackend(page)
    await routeDocPreflight(page, 'd_forbidden', 403)

    let viewCalls = 0
    await page.route('**/api/v1/docs/d_forbidden/view', (route: Route) => {
      viewCalls += 1
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/d/d_forbidden')

    await expect(page.locator('.octo-terminal')).toBeVisible()
    expect(viewCalls).toBe(0)
  })
})
