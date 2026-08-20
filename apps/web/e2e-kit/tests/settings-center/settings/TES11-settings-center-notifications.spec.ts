/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/settings-center/settings/TES11-settings-center-notifications.md
import { test, expect } from "../../../fixtures-authed";

test("@TES11 @p1 @settings-center @notifications 通知设置可交互", async ({ authedPage }) => {
  await authedPage.getByRole("button", { name: "设置" }).click();
  await authedPage.getByTestId("settings-center-nav-notifications").click();

  const content = authedPage.getByTestId("settings-center-content");
  await expect(content).toContainText("通知与声音");

  const muteScopes = content.getByRole("combobox");
  await expect(muteScopes).toHaveCount(1);
  const muteScope = muteScopes;
  await expect(muteScope).toHaveValue("sound-and-popup");
  await muteScope.selectOption("sound");
  await expect(muteScope).toHaveValue("sound");

  const notificationOptions = authedPage.getByRole("switch", { name: "通知选项" });
  await expect(notificationOptions).toBeChecked();
  await notificationOptions.click();
  await expect(notificationOptions).not.toBeChecked();
});
