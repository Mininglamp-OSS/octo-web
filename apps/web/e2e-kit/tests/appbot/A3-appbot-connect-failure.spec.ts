// @caseId A3-appbot-connect-failure
// @spec apps/web/e2e-kit/case-specs/appbot/A3-appbot-connect-failure.md

import { test, expect } from "../../fixtures-authed";
import { registerA3AppbotConnectFailure } from "../../msw-handlers/a3-appbot-connect-failure";

test("@A3 @p1 @appbot @appbot-connect Appbot 连接失败保留列表并提示", async ({
  authedPage,
}) => {
  await registerA3AppbotConnectFailure(authedPage);
  await authedPage.getByRole("button", { name: "应用", exact: true }).click();
  await expect(authedPage.getByTestId("appbot-page-title")).toHaveText("应用");

  const app = authedPage.getByRole("button", { name: /文档助手/ });
  await expect(app).toBeVisible();
  await app.click();

  await expect(
    authedPage.getByText("无法连接到该应用，请稍后重试", { exact: true }),
  ).toBeVisible();
  await expect(app).toBeVisible();
  await expect(authedPage.getByTestId("appbot-page-title")).toHaveText("应用");
});
