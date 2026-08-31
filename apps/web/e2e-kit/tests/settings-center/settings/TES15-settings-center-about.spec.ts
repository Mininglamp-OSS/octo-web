/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/settings-center/settings/TES15-settings-center-about.md
import { test, expect } from "../../../fixtures-authed";

test("@TES15 @p1 @settings-center @about 关于页展示产品信息", async ({ authedPage }) => {
  await authedPage.getByRole("button", { name: "设置" }).click();
  await authedPage.getByRole("combobox", { name: "界面语言" }).selectOption("en-US");
  const content = authedPage.getByTestId("settings-center-content");
  await authedPage.getByTestId("settings-center-nav-about").click();

  await expect(content).toContainText("Help and about");
  await expect(content).toContainText("Current version");
  await expect(content.locator(".wk-settings-center__about-update-actions")).toBeVisible();
  await expect(content.getByRole("status")).toContainText("Not checked yet");
  await expect(content.getByRole("button", { name: "Check for updates" })).toBeVisible();
  for (const label of ["Welcome guide", "Feedback", "Changelog", "Octo website", "Product manual", "Octo open source", "Open-source licenses"]) {
    await expect(content.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(content.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "https://github.com/Mininglamp-OSS/octo-web/issues/new");
  await expect(content.getByRole("link", { name: "Octo website" })).toHaveAttribute("href", "https://www.mininglamp.com/");
  await expect(content.getByRole("link", { name: "Product manual" })).toHaveAttribute("href", "/product-docs");
  await expect(content.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
  await expect(content.getByRole("link", { name: "Changelog" })).toHaveAttribute("target", "_blank");
  await expect(content.getByRole("link", { name: "Octo open source" })).toHaveAttribute("href", "https://github.com/Mininglamp-OSS");
  await expect(content.getByRole("link", { name: "Open-source licenses" })).toHaveAttribute("href", "https://github.com/Mininglamp-OSS/octo-web/blob/main/LICENSE");
});
