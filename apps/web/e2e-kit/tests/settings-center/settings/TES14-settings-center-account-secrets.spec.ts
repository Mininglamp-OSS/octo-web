/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/settings-center/settings/TES14-settings-center-account-secrets.md
import { test, expect } from "../../../fixtures-authed";

async function installAccountSecretsHandlers(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (url: string, handler: unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (globalThis as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("MSW not ready");
    msw.worker.use(
      msw.http.get("*/manager/secrets", () => msw.HttpResponse.json({ secrets: [] })),
      msw.http.get("*/api/v1/manager/secrets", () => msw.HttpResponse.json({ secrets: [] })),
      msw.http.get("*/users/:uid", () => msw.HttpResponse.json({
        uid: "e2e-user-1",
        name: "E2E Tester",
        short_no: "10000",
        sex: 1,
        realname_verified: false,
        real_name: "",
      })),
      msw.http.get("*/api/v1/users/:uid", () => msw.HttpResponse.json({
        uid: "e2e-user-1",
        name: "E2E Tester",
        short_no: "10000",
        sex: 1,
        realname_verified: false,
        real_name: "",
      })),
    );
  });
}

test("@TES14 @p1 @settings-center @account @secrets 账户页进入密钥管理", async ({ authedPage }) => {
  await installAccountSecretsHandlers(authedPage);
  await authedPage.getByRole("button", { name: "设置" }).click();
  const content = authedPage.getByTestId("settings-center-content");

  await authedPage.getByTestId("settings-center-nav-account").click();
  await expect(content).toContainText("账号与安全");
  await expect(content).toContainText("个人资料");
  await expect(content).toContainText("密钥管理");

  await content.getByRole("button", { name: "管理" }).click();
  await expect(content).toContainText("密钥 / Secrets");
  await expect(content).toContainText("还没有密钥");
  const addSecretButton = authedPage.getByRole("button", { name: /添加第一个密钥/ });
  await expect(addSecretButton).toBeVisible();
  await addSecretButton.click();

  const editorDialog = authedPage.getByRole("dialog").last();
  await expect(editorDialog.getByText("新增密钥", { exact: true })).toBeVisible();
  await expect(authedPage.getByPlaceholder("例如：我的 Claude 密钥、公司 OpenAI")).toBeVisible();
  await expect(authedPage.getByPlaceholder("粘贴你的密钥，例如 sk-…")).toBeVisible();
  await expect(authedPage.getByTestId("settings-center-secondary-back")).toBeVisible();
});
