/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/space/SP1-space-gate-create.md

import { test, expect, E2E_SID, AUTH_KEYS_SUFFIXED, MOCK_LOCALE } from "../../fixtures-authed";
import { registerSP1SpaceGateCreate } from "../../msw-handlers/sp1-space-gate-create";

test("@SP1 @p0 @space @space-gate 无 Space 后创建组织进入主界面", async ({ pagePlain }) => {
  let created = false;
  const space = { space_id: "sp1-created-space", name: "SP1 新组织", description: "", logo: "", create_at: "2026-08-25T00:00:00Z", update_at: "2026-08-25T00:00:00Z", space_no: "sp1-created-space", owner: "e2e-user-1", status: 1, role: 2 };
  // The MSW baseline owns cold-start and post-create bootstrap endpoints.
  // Playwright routes remain as a cold-start fallback when the worker has not
  // taken control yet; the MSW scenario owns the same business state.
  await pagePlain.route("**/api/v1/space/my**", (route) => route.fulfill({ json: created ? [space] : [] }));
  await pagePlain.route("**/api/v1/users/e2e-user-1/avatar**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([]) }));
  await pagePlain.route("**/api/v1/sidebar/sync", (route) => route.fulfill({ json: { conversations: [], groups: [], users: [] } }));
  await pagePlain.addInitScript(({ sid, suffixed, locale }: { sid: string; suffixed: Record<string, string>; locale: string }) => {
    const ls = localStorage;
    const ss = sessionStorage;
    ss.setItem("octo.session.sid", sid);
    if (!ss.getItem("__e2e_scenario")) ss.setItem("__e2e_scenario", "sp1-space-gate");
    const scenario = ss.getItem("__e2e_scenario");
    if (scenario !== "sp1-space-gate-created") ls.removeItem("currentSpaceId");
    ls.setItem("octo:locale", locale);
    ls.setItem("octo:onboarding:seen", "seen");
    for (const [key, value] of Object.entries(suffixed)) ls.setItem(`${key}${sid}`, value);
  }, { sid: E2E_SID, suffixed: AUTH_KEYS_SUFFIXED, locale: MOCK_LOCALE });
  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as unknown as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerSP1SpaceGateCreate(pagePlain);

  await expect(pagePlain.getByText("输入邀请码加入你的组织", { exact: true })).toBeVisible();
  await expect(pagePlain.getByRole("heading", { name: "欢迎使用 Octo！" })).toBeVisible();
  await expect(pagePlain.getByRole("button", { name: /创建新组织/ })).toBeVisible();
  await expect(pagePlain.getByText("Chat", { exact: true })).toHaveCount(0);

  await pagePlain.getByRole("button", { name: /创建新组织/ }).click();
  const dialog = pagePlain.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("输入组织名称").fill("SP1 新组织");
  const createResponse = pagePlain.waitForResponse("**/api/v1/space/create");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect((await createResponse).status()).toBe(200);
  created = true;
  await expect(pagePlain.getByRole("button", { name: "切换组织" })).toContainText("SP1 新组织", { timeout: 15_000 });
  await expect(pagePlain.getByRole("heading", { name: "欢迎使用 Octo！" })).toHaveCount(0);
});
