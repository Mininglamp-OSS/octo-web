import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID } from "../../fixtures-authed";
import { registerSP5SpaceInviteApproval } from "../../msw-handlers/sp5-space-invite-approval";

test("@SP5 @p1 @space @invite @approval 邀请加入需审批", async ({ pagePlain }) => {
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
      if (url.includes("/space/invite/SP5-APPROVAL")) {
        return new Response(JSON.stringify({
          invite_code: "SP5-APPROVAL",
          space_id: "sp5-approval-space",
          space_name: "SP5 审批组织",
          member_count: 1,
          max_users: 100,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/space/join") && init?.method === "POST") {
        return new Response(JSON.stringify({ space_id: "sp5-approval-space", status: "NEED_APPROVAL" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  });
  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerSP5SpaceInviteApproval(pagePlain);
  await pagePlain.waitForFunction(
    () => (globalThis as { __sp5MswInstalled?: boolean }).__sp5MswInstalled === true,
  );
  await pagePlain.route("**/api/v1/space/invite/SP5-APPROVAL", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        invite_code: "SP5-APPROVAL",
        space_id: "sp5-approval-space",
        space_name: "SP5 审批组织",
        member_count: 1,
        max_users: 100,
      }),
    }),
  );
  await pagePlain.goto(`/?sid=${E2E_SID}&invite=SP5-APPROVAL`);

  await expect(pagePlain.getByText("SP5 审批组织", { exact: true })).toBeVisible();
  await pagePlain.getByRole("button", { name: "加入组织", exact: true }).click();

  await expect(pagePlain.getByText("申请已提交", { exact: true })).toBeVisible();
  await expect(
    pagePlain.getByText(/你的加入申请已提交，请等待管理员审批通过后即可加入/)
  ).toBeVisible();
  await expect(pagePlain.getByText("已加入", { exact: true })).toHaveCount(0);
  await expect(pagePlain.getByText("选择对话，激活连接", { exact: true })).toHaveCount(0);
});
