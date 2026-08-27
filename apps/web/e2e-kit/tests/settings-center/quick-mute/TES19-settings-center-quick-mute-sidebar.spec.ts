/* eslint-disable no-undef */
/** spec: apps/web/e2e-kit/case-specs/settings-center/quick-mute/TES19-settings-center-quick-mute-sidebar.md */
import { test, expect } from "../../../fixtures-authed";
import { registerTES19SettingsCenterQuickMute } from "../../../msw-handlers/tes19-settings-center-quick-mute";

test("@TES19 @p1 @settings-center @quick-mute @sidebar sidebar 快捷静音可暂停并恢复提醒", async ({ authedPage }) => {
  await registerTES19SettingsCenterQuickMute(authedPage);

  const remindersOn = authedPage.getByRole("button", { name: "提醒开启" });
  await expect(remindersOn).toBeVisible();
  await remindersOn.click();

  const menu = authedPage.getByRole("menu", { name: "暂停通知" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "静音 30 分钟" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "静音 30 分钟" }).click();

  const muted = authedPage.getByRole("button", { name: "已静音" });
  await expect(muted).toBeVisible();
  await expect(menu).toBeHidden();

  await muted.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "恢复提醒" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "恢复提醒" }).click();

  await expect(authedPage.getByRole("button", { name: "提醒开启" })).toBeVisible();
  await expect(menu).toBeHidden();
});
