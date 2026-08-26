import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID, MOCK_LOCALE, LOCALE_STORAGE_KEY, ONBOARDING_STORAGE_KEY, SPACE_STORAGE_KEY } from "../../fixtures-authed";
import { registerSP2SpaceInviteLogin } from "../../msw-handlers/sp2-space-invite-login";

test("@SP2 @p1 @space @invite @login 邀请链接登录后自动加入 Space", async ({ pagePlain }) => {
  await pagePlain.addInitScript(({ sid, auth, spaceKey, spaceId, localeKey, locale, onboardingKey, scenario }) => {
    if (!sessionStorage.getItem("__e2e_scenario")) {
      localStorage.clear();
      sessionStorage.setItem("octo.session.sid", sid); sessionStorage.setItem("__e2e_scenario", scenario);
      for (const [key, value] of Object.entries(auth)) localStorage.setItem(`${key}${sid}`, value);
      localStorage.setItem(spaceKey, spaceId); localStorage.setItem(localeKey, locale); localStorage.setItem(onboardingKey, "seen");
    }
    localStorage.setItem(localeKey, locale); localStorage.setItem(onboardingKey, "seen");
  }, { sid: E2E_SID, auth: AUTH_KEYS_SUFFIXED, spaceKey: SPACE_STORAGE_KEY, spaceId: "", localeKey: LOCALE_STORAGE_KEY, locale: MOCK_LOCALE, onboardingKey: ONBOARDING_STORAGE_KEY, scenario: "sp2-space-invite-login" });

  // Remove the auth seed for the first navigation, while retaining the case scenario.
  await pagePlain.addInitScript(({ sid }) => {
    if (!location.search.includes("action=login")) {
      const authKey = new RegExp(`^(token|uid|name|app_id|short_no|role|is_work|sex|login_provider)${sid}$`);
      for (const key of Object.keys(localStorage)) if (authKey.test(key)) localStorage.removeItem(key);
    }
  }, { sid: E2E_SID });
  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerSP2SpaceInviteLogin(pagePlain);
  await pagePlain.goto(`/?sid=${E2E_SID}&invite=SP2-INVITE`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await pagePlain.waitForFunction(() => {
    const w = globalThis as { __sp2MswInstalled?: boolean; __sp2MswError?: string };
    if (w.__sp2MswError) throw new Error(w.__sp2MswError);
    return w.__sp2MswInstalled === true;
  });
  await expect(pagePlain.getByTestId("invite-landing-login-cta")).toBeVisible({ timeout: 15_000 });
  await pagePlain.getByTestId("invite-landing-login-cta").click();
  await expect(pagePlain.locator('input[name="username"]')).toBeVisible({ timeout: 15_000 });
  await pagePlain.locator('input[name="username"]').fill("e2e@example.com");
  await pagePlain.locator('input[name="password"]').fill("e2e-password");
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await expect.poll(() => pagePlain.evaluate(() => localStorage.getItem("pendingInviteCode"))).toBe("SP2-INVITE");
  const joinRequest = pagePlain.waitForRequest("**/api/v1/space/join**");
  await pagePlain.getByRole("button", { name: "登录" }).click();
  expect((await (await joinRequest).postDataJSON() as { invite_code?: string }).invite_code).toBe("SP2-INVITE");
  await expect(pagePlain.getByRole("button", { name: "切换组织" })).toContainText("SP2 邀请空间", { timeout: 15_000 });
  await expect(pagePlain.getByTestId("invite-landing-login-cta")).toHaveCount(0);
});
