import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID, MOCK_LOCALE, LOCALE_STORAGE_KEY, ONBOARDING_STORAGE_KEY, SPACE_STORAGE_KEY } from "../../fixtures-authed";
import { registerS26SummaryStandaloneLinks } from "../../msw-handlers/s26-summary-standalone-links";

test("@S26 @p1 @summary @deep-link 独立详情与分享链接", async ({ pagePlain }) => {
  await pagePlain.route(
    /\/summary\/api\/v1\/summaries\?page=1&page_size=1$/,
    (route) =>
      route.fulfill({
        json: { code: 0, message: "ok", data: { items: [], total: 0 } },
      })
  );
  await pagePlain.addInitScript(({ sid, auth, spaceKey, spaceId, localeKey, locale, onboardingKey, scenario }) => {
    const ls = localStorage;
    const ss = sessionStorage;
    ss.setItem("octo.session.sid", sid);
    ss.setItem("__e2e_scenario", scenario);
    for (const [key, value] of Object.entries(auth)) ls.setItem(`${key}${sid}`, value);
    ls.setItem(spaceKey, spaceId); ls.setItem(localeKey, locale); ls.setItem(onboardingKey, "seen");
  }, { sid: E2E_SID, auth: AUTH_KEYS_SUFFIXED, spaceKey: SPACE_STORAGE_KEY, spaceId: "e2e-space-001", localeKey: LOCALE_STORAGE_KEY, locale: MOCK_LOCALE, onboardingKey: ONBOARDING_STORAGE_KEY, scenario: "s26-summary-standalone-links" });

  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerS26SummaryStandaloneLinks(pagePlain);
  await pagePlain.goto(`/s/e2e-task-026?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => {
    const w = globalThis as { __s26MswInstalled?: boolean; __s26MswError?: string };
    if (w.__s26MswError) throw new Error(w.__s26MswError);
    return w.__s26MswInstalled === true;
  });
  await expect(pagePlain.getByRole("heading", { name: "S26 独立总结详情", level: 2 })).toBeVisible({ timeout: 15_000 });
  await expect(pagePlain.getByText("这是从任务链接直接打开的总结正文。", { exact: true })).toBeVisible();
  await expect(pagePlain.getByText("登录", { exact: true })).toHaveCount(0);

  await pagePlain.goto(`/s/share/e2e-share-026?sid=${E2E_SID}`);
  await expect(pagePlain.getByRole("heading", { name: "S26 分享总结" })).toBeVisible({ timeout: 15_000 });
  await expect(pagePlain.getByText("这是从分享链接直接打开的总结正文。", { exact: true })).toBeVisible();
  await expect(pagePlain.getByText("登录", { exact: true })).toHaveCount(0);

  await pagePlain.goto(`/s?sid=${E2E_SID}`);
  await expect(pagePlain.getByRole("heading", { name: /S26 .*详情/ })).toHaveCount(0);
  await pagePlain.goto(`/s/e2e-task-026/extra?sid=${E2E_SID}`);
  await expect(pagePlain.getByRole("heading", { name: /S26 .*详情/ })).toHaveCount(0);
});
