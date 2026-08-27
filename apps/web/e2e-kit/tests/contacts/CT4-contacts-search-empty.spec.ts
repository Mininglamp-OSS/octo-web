import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";
import { registerCT4ContactsSearchEmpty } from "../../msw-handlers/ct4-contacts-search-empty";

test("@CT4 @p1 @contacts @contacts-search 通讯录搜索无结果显示空态", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }], groups: [], conversations: [], messages: [], subscribers: [],
  });
  await registerCT4ContactsSearchEmpty(authedPage);
  await authedPage.getByRole("button", { name: "通讯录", exact: true }).click();
  await expect(authedPage.getByText("E2E 联系人", { exact: true })).toBeVisible();
  await authedPage.getByPlaceholder("搜索通讯录", { exact: true }).fill("不存在的人");
  await expect(authedPage.getByText("没有找到相关联系人", { exact: true })).toBeVisible();
  await expect(authedPage.getByText("E2E 联系人", { exact: true })).toHaveCount(0);
  await expect(authedPage.getByText("其他成员", { exact: true })).toHaveCount(0);
});
