/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/settings-center/settings/TES12-settings-center-general.md
import { test, expect } from "../../../fixtures-authed";

test("@TES12 @p1 @settings-center @general 通用设置切换语言", async ({ authedPage }) => {
  await authedPage.getByRole("button", { name: "设置" }).click();
  await expect(authedPage.getByTestId("settings-center-nav-general")).toHaveAttribute("aria-current", "page");

  const languageSelect = authedPage.getByRole("combobox", { name: "界面语言" });
  await languageSelect.selectOption("en-US");

  await expect(authedPage.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(authedPage.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(authedPage.getByText("深色主题即将上线", { exact: true })).toBeHidden();
});
