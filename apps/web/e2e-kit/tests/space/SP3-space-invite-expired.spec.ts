import {
  test,
  expect,
  E2E_SID,
  LOCALE_STORAGE_KEY,
  MOCK_LOCALE,
  ONBOARDING_STORAGE_KEY,
} from "../../fixtures-authed";
import { registerSP3SpaceInviteExpired } from "../../msw-handlers/sp3-space-invite-expired";

test("@SP3 @p1 @space @invite @expired 过期邀请链接显示不可用状态", async ({ pagePlain }) => {
  await pagePlain.addInitScript(
    ({ localeKey, locale, onboardingKey }) => {
      localStorage.setItem(localeKey, locale);
      localStorage.setItem(onboardingKey, "seen");
      sessionStorage.setItem("octo.session.sid", "e2etest");
    },
    { localeKey: LOCALE_STORAGE_KEY, locale: MOCK_LOCALE, onboardingKey: ONBOARDING_STORAGE_KEY },
  );

  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerSP3SpaceInviteExpired(pagePlain);
  await pagePlain.waitForFunction(() => (globalThis as { __sp3MswInstalled?: boolean }).__sp3MswInstalled === true, undefined, { timeout: 15_000 });
  // The invite page fetches during the navigation that enters it. Keep a
  // Playwright fallback for preview runs where the service worker is restarted
  // between the seed page and the invite deep link.
  await pagePlain.route("**/api/v1/space/invite/SP3-EXPIRED", (route) =>
    route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({ code: 41001, message: "邀请码已过期" }),
    })
  );
  await pagePlain.goto(`/?sid=${E2E_SID}&invite=SP3-EXPIRED`);

  await expect(pagePlain.getByText(/邀请码无效/)).toBeVisible();
  const backButton = pagePlain.getByRole("button", { name: "返回", exact: true });
  await expect(backButton).toBeVisible();
  await backButton.click();
  await expect.poll(() => new URL(pagePlain.url()).searchParams.has("invite")).toBe(false);
});
