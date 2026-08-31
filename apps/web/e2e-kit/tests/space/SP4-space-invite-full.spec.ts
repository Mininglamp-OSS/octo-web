import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID } from "../../fixtures-authed";
import { registerSP4SpaceInviteFull } from "../../msw-handlers/sp4-space-invite-full";

test("@SP4 @p1 @space @invite @full 满员 Space 禁止加入", async ({ pagePlain }) => {
  await pagePlain.addInitScript(({ sid, auth }) => {
    sessionStorage.setItem("octo.session.sid", sid);
    for (const [key, value] of Object.entries(auth)) localStorage.setItem(`${key}${sid}`, value);
    localStorage.setItem("currentSpaceId", "e2e-space-001");
    localStorage.setItem("octo:locale", "zh-CN");
    localStorage.setItem("octo:onboarding:seen", "seen");
  }, { sid: E2E_SID, auth: AUTH_KEYS_SUFFIXED });
  await pagePlain.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/space/invite/SP4-FULL")) {
        return new Response(JSON.stringify({
          invite_code: "SP4-FULL",
          space_id: "sp4-full-space",
          space_name: "SP4 满员组织",
          member_count: 100,
          max_users: 100,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });
  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerSP4SpaceInviteFull(pagePlain);
  await pagePlain.waitForFunction(
    () => (globalThis as { __sp4MswInstalled?: boolean }).__sp4MswInstalled === true,
  );
  await pagePlain.route("**/api/v1/space/invite/SP4-FULL", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        invite_code: "SP4-FULL",
        space_id: "sp4-full-space",
        space_name: "SP4 满员组织",
        member_count: 100,
        max_users: 100,
      }),
    }),
  );
  await pagePlain.goto(`/?sid=${E2E_SID}&invite=SP4-FULL`);

  await expect(pagePlain.getByText("SP4 满员组织", { exact: true })).toBeVisible();
  await expect(pagePlain.getByText("100/100 人", { exact: true })).toBeVisible();

  const joinButton = pagePlain.getByRole("button", { name: "组织已满", exact: true });
  await expect(joinButton).toBeVisible();
  await expect(joinButton).toBeDisabled();
});
