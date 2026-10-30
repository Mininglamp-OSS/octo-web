// @caseId SK6-skill-upgrade-leave-confirm
// @spec apps/web/e2e-kit/case-specs/skills/SK6-skill-upgrade-leave-confirm.md

import { test, expect } from "../../fixtures-authed";
import { registerSkillUpgradeLeaveConfirm } from "../../msw-handlers/sk6-skill-upgrade-leave-confirm";

for (const viewport of [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`@SK6 @p1 @skills upgrade leave confirmation: ${viewport.name}`, async ({ authedPage: page }, testInfo) => {
    await page.setViewportSize(viewport);
    await registerSkillUpgradeLeaveConfirm(page);
    await page.goto("/mcp-market/mine?type=skills&sid=e2etest");

    await page.getByRole("button", { name: "为「upgrade-leave-demo」升级版本" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("升级版本");

    await dialog.getByPlaceholder("例如 1.2.0").fill("2.0.0");
    await dialog.getByPlaceholder("简述本次提交的变更内容").fill("保留这份发布说明");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();

    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog).toContainText("确认离开升级？");
    await expect(dialog).toContainText("离开后将丢失");
    await expect(dialog.getByPlaceholder("例如 1.2.0")).toHaveCount(0);

    const keepEditing = dialog.getByRole("button", { name: "继续编辑", exact: true });
    const confirmLeave = dialog.getByRole("button", { name: "确认离开", exact: true });
    await expect(keepEditing).toBeFocused();
    await expect(keepEditing).toBeInViewport();
    await expect(confirmLeave).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`upgrade-leave-${viewport.name}.png`) });

    await page.keyboard.press("Escape");
    await expect(dialog.getByPlaceholder("例如 1.2.0")).toHaveValue("2.0.0");
    await expect(dialog.getByPlaceholder("简述本次提交的变更内容")).toHaveValue("保留这份发布说明");

    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toContainText("确认离开升级？");
    await confirmLeave.click();
    await expect(dialog).not.toBeVisible();
  });
}
