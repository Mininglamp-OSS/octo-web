/* spec: apps/web/e2e-kit/case-specs/settings-center/shell/TES10-settings-center-shell.md */
import { test, expect } from "../../../fixtures-authed";

test("@p0 @TES10 settings center shell interaction", async ({ authedPage }) => {
  const settingsButton = authedPage.getByRole("button", { name: "设置" });
  await expect(settingsButton).toBeVisible({ timeout: 15_000 });
  await settingsButton.click();
  const center = authedPage.getByTestId("settings-center");
  await expect(center).toBeVisible();
  await expect(authedPage.getByTestId("settings-center-nav-general")).toHaveAttribute("aria-current", "page");
  await expect(authedPage.getByText("桌面应用")).toBeHidden();
  await expect(authedPage.getByTestId("settings-center-content")).toContainText("通用");

  await expect(authedPage.getByTestId("settings-center-logout")).toBeVisible();
  await authedPage.getByTestId("settings-center-logout").click();
  await expect(center).toBeHidden();
});
