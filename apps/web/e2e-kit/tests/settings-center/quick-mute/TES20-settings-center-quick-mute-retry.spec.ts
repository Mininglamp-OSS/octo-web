/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/settings-center/quick-mute/TES20-settings-center-quick-mute-retry.md
 *
 * TES20: 快捷静音保存失败后重试.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerTES20SettingsCenterQuickMuteRetry } from "../../../msw-handlers/tes20-settings-center-quick-mute-retry";

test("@TES20 @p1 @settings-center @quick-mute @error-state 快捷静音保存失败后重试", async ({ authedPage }) => {
  await registerTES20SettingsCenterQuickMuteRetry(authedPage);
  const remindersOn = authedPage.getByRole("button", { name: "提醒开启" });
  await expect(remindersOn).toBeVisible();
  await remindersOn.click();

  const menu = authedPage.getByRole("menu", { name: "暂停通知" });
  await menu.getByRole("menuitem", { name: "静音 30 分钟" }).click();
  await expect(menu.getByRole("alert")).toContainText("保存失败，原状态未改变。");
  await expect(authedPage.getByRole("button", { name: "提醒开启" })).toBeVisible();

  await menu.getByRole("button", { name: "重试" }).click();
  await expect(authedPage.getByRole("button", { name: "已静音" })).toBeVisible();
  await expect(menu).toBeHidden();
});
