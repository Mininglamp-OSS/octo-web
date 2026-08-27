// @caseId CT5-contacts-group-create-failure
// @spec apps/web/e2e-kit/case-specs/contacts/CT5-contacts-group-create-failure.md

import { test, expect } from "../../fixtures-authed";
import { registerCT5ContactsGroupCreateFailure } from "../../msw-handlers/ct5-contacts-group-create-failure";

test("@CT5 @p1 @contacts @contacts-group 发起群聊失败保留表单", async ({
  authedPage,
}) => {
  await registerCT5ContactsGroupCreateFailure(authedPage);
  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByTestId("chat-add-entry").click();
  await authedPage.getByRole("list").getByText("发起群聊", { exact: true }).click();

  const dialog = authedPage.locator(".wk-modal-content").filter({ hasText: "发起群聊" });
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByPlaceholder("例：工作，学习，项目名称...");
  await nameInput.fill("E2E 创建失败群");
  await dialog.getByText("E2E 建群成员", { exact: true }).click();
  await expect(dialog.getByText("已选1人", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确定" }).last().click();

  await expect(authedPage.getByText("创建群聊失败", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(nameInput).toHaveValue("E2E 创建失败群");
  await expect(dialog.getByText("E2E 建群成员", { exact: true }).last()).toBeVisible();
  await expect(dialog.getByText("已选1人", { exact: true })).toBeVisible();
  await expect(authedPage.getByRole("heading", { name: "E2E 创建失败群" })).toHaveCount(0);
});
