import { test, expect } from "../fixtures-authed";

test.use({ video: "on", trace: "on" });

test("@p0 @TES10 settings center shell interaction", async ({ authedPage }, testInfo) => {
  const frame = (name: string) => testInfo.outputPath(`${name}.png`);
  await authedPage.screenshot({ path: frame("01-main"), fullPage: true });
  const quickMuteButton = authedPage.getByRole("button", { name: "提醒开启" });
  await expect(quickMuteButton).toBeVisible();
  await quickMuteButton.click();
  await expect(authedPage.getByRole("menu", { name: "暂停通知" })).toBeVisible();
  await expect(authedPage.getByRole("menuitem", { name: "静音 30 分钟" })).toBeVisible();
  await authedPage.keyboard.press("Escape");
  const settingsButton = authedPage.getByRole("button", { name: "设置" });
  await expect(settingsButton).toBeVisible({ timeout: 15_000 });
  await settingsButton.click();
  await authedPage.screenshot({ path: frame("02-settings-menu"), fullPage: true });
  const center = authedPage.getByTestId("settings-center");
  await expect(center).toBeVisible();
  await expect(authedPage.getByTestId("settings-center-nav-general")).toHaveAttribute("aria-current", "page");
  await expect(authedPage.getByText("桌面应用")).toBeHidden();
  const languageSelect = authedPage.getByRole("combobox").first();
  await expect(languageSelect).toBeVisible();
  await languageSelect.selectOption("en-US");
  await expect(authedPage.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(authedPage.getByText("深色主题即将上线", { exact: true })).toBeHidden();
  await expect(authedPage.getByText("Coming soon", { exact: true })).toBeVisible();
  await authedPage.screenshot({ path: frame("03-settings-center-general"), fullPage: true });
  await authedPage.getByTestId("settings-center-nav-notifications").click();
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Notifications and sound");
  await expect(authedPage.getByRole("combobox", { name: "Mute behavior" })).toBeVisible();
  await expect(authedPage.getByRole("switch", { name: "Notification options" })).toBeVisible();
  await authedPage.screenshot({ path: frame("04-settings-center-notifications"), fullPage: true });

  await authedPage.getByTestId("settings-center-nav-shortcuts").click();
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Voice input");
  await expect(authedPage.getByTestId("settings-center-content")).not.toContainText("New chat");
  await expect(authedPage.getByTestId("settings-center-content")).not.toContainText("Navigation");
  await expect(authedPage.locator(".wk-settings-center__shortcut-row")).toHaveCount(2);
  await expect(authedPage.locator("kbd")).toHaveCount(3);
  await authedPage.screenshot({ path: frame("05-settings-center-shortcuts"), fullPage: true });

  await authedPage.getByTestId("settings-center-nav-devices").click();
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Use Octo on other devices");
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Android");
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Mobile");
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Extensions and connections");
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Source: ClawHub · GitHub");
  await expect(authedPage.locator(".wk-settings-center__resource-card")).toHaveCount(6);
  await expect(authedPage.getByRole("link", { name: "Download from GitHub" })).toHaveAttribute("href", "https://github.com/Mininglamp-OSS/octo-android/releases/latest");
  await authedPage.screenshot({ path: frame("06-settings-center-resources"), fullPage: true });

  await authedPage.getByTestId("settings-center-nav-about").click();
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Help and about");
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("Current version");
  await authedPage.screenshot({ path: frame("07-settings-center-about"), fullPage: true });

  await expect(authedPage.getByTestId("settings-center-logout")).toBeVisible();
  await authedPage.getByTestId("settings-center-logout").click();
  await expect(center).toBeHidden();
  await authedPage.screenshot({ path: frame("08-settings-center-closed"), fullPage: true });
});
