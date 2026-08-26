/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";

async function enableMail(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "mail");
  });
}

test.describe("@MA1 @p1 @mail @mail-authorization", () => {
  test("缺少组织信息显示重新接入提示", async ({ authedPage }) => {
    await enableMail(authedPage);
    await authedPage.goto("/mail/authorize?code=E2E-CODE&sid=e2etest");
    await expect(
      authedPage.getByRole("heading", { name: "授权 Agent 使用邮箱" })
    ).toBeVisible();
    await expect(
      authedPage.getByText(
        "授权链接缺少组织信息，请返回邮箱管理页重新发起接入。",
        {
          exact: true,
        }
      )
    ).toBeVisible();
  });
});

test.describe("@MA2 @p1 @mail @mail-authorization", () => {
  test("缺少授权 code 显示无效提示", async ({ authedPage }) => {
    await enableMail(authedPage);
    await authedPage.goto("/mail/authorize?space_id=e2e-space-001&sid=e2etest");
    await expect(
      authedPage.getByRole("heading", { name: "授权 Agent 使用邮箱" })
    ).toBeVisible();
    await expect(
      authedPage.getByText("授权码无效，请让 Bot 重新发起接入。", {
        exact: true,
      })
    ).toBeVisible();
  });
});
