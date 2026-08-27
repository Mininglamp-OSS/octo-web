/* eslint-disable no-undef -- e2e code runs in Node */
/** spec: e2e-kit/case-specs/cross-module/X3-summary-share-space-isolation.md */
import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID, MOCK_LOCALE, LOCALE_STORAGE_KEY, ONBOARDING_STORAGE_KEY, SPACE_STORAGE_KEY } from "../../fixtures-authed";
import { registerX3SummaryShareSpaceIsolation } from "../../msw-handlers/x3-summary-share-space-isolation";

test("@X3 @p1 @cross-module @summary @deep-link @permission Summary 分享无权访问显示错误态", async ({ pagePlain }) => {
  await pagePlain.addInitScript(({ sid, auth, spaceKey, localeKey, locale, onboardingKey }) => {
    sessionStorage.setItem("octo.session.sid", sid);
    for (const [key, value] of Object.entries(auth)) localStorage.setItem(`${key}${sid}`, value);
    localStorage.setItem(spaceKey, "e2e-space-002");
    localStorage.setItem(localeKey, locale);
    localStorage.setItem(onboardingKey, "seen");
  }, { sid: E2E_SID, auth: AUTH_KEYS_SUFFIXED, spaceKey: SPACE_STORAGE_KEY, localeKey: LOCALE_STORAGE_KEY, locale: MOCK_LOCALE, onboardingKey: ONBOARDING_STORAGE_KEY });

  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerX3SummaryShareSpaceIsolation(pagePlain);
  await pagePlain.waitForFunction(() => (globalThis as { __s26MswInstalled?: boolean }).__s26MswInstalled === true, undefined, { timeout: 15_000 });
  await pagePlain.route(/\/summary-shares\/e2e-share-026(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: 40301, message: "space access denied", data: null }),
    }),
  );
  await pagePlain.goto(`/s/share/e2e-share-026?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __x3Installed?: boolean }).__x3Installed === true, undefined, { timeout: 15_000 });

  await expect(pagePlain.getByText("该分享不存在、已失效或你无权查看", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(pagePlain.getByRole("heading", { name: "S26 分享总结" })).toHaveCount(0);
  await expect(pagePlain.getByText("这是从分享链接直接打开的总结正文。", { exact: true })).toHaveCount(0);
});
