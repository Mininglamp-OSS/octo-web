/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/create/S8-summary-create-participants.md
 *
 * S8: Summary 创建时选择参与者.
 */
import { test, expect } from "../../../fixtures-authed";
import { installMockImRuntime } from "../../../_kit/mock-im-runtime";
import { registerS8SummaryCreateParticipants } from "../../../msw-handlers/s8-summary-create-participants";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S8 @p1 @summary @create @summary-create @member-select S8 — Summary 创建参与者", () => {
  test("选择聊天成员作为参与者后创建总结", async ({ authedPage }) => {
    await registerS8SummaryCreateParticipants(authedPage);
    await installMockImRuntime(authedPage, {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [
        { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
        { uid: "s8-member-a", name: "S8 Alice", robot: 0 },
        { uid: "s8-member-b", name: "S8 Bob", robot: 0 },
      ],
      groups: [{ group_no: "s8-project-group", name: "S8 项目群" }],
      conversations: [{ channelId: "s8-project-group", channelType: 2, unread: 0 }],
      subscribers: [
        { uid: "e2e-user-1", name: "E2E Tester", channelId: "s8-project-group", channelType: 2, role: 1, robot: 0 },
        { uid: "s8-member-a", name: "S8 Alice", channelId: "s8-project-group", channelType: 2, role: 0, robot: 0 },
        { uid: "s8-member-b", name: "S8 Bob", channelId: "s8-project-group", channelType: 2, role: 0, robot: 0 },
      ],
    });
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });
    const startButton = authedPage.getByTestId(T.createSubmit);
    await expect(startButton).toBeDisabled();

    await authedPage.getByTestId(T.createSelectChat).click();
    await authedPage.getByTestId(T.chatSelectorAllGroupsTab).click();
    await authedPage.getByText("S8 项目群", { exact: true }).click();
    await expect(authedPage.getByText("已选 1 / 30")).toBeVisible();
    await authedPage.getByTestId(T.chatSelectorConfirmBtn).click();
    await expect(authedPage.getByText("S8 项目群", { exact: true })).toBeVisible();

    await authedPage.getByTestId(T.createSelectMembers).click();
    await expect(authedPage.getByText("选择参与者").last()).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S8 Alice", { exact: true }).click();
    await expect(authedPage.getByText("已选 1 / 30")).toBeVisible();
    await authedPage.getByTestId(T.memberSelectorConfirmBtn).click();
    await expect(authedPage.getByText("S8 Alice", { exact: true })).toBeVisible();

    await authedPage
      .getByTestId(T.createTopic)
      .fill("S8 多人协作总结");
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(authedPage.getByText("总结任务已创建")).toBeVisible({ timeout: 15_000 });
    await expect(
      authedPage.getByRole("heading", { name: "S8 多人协作总结", level: 2 })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S8 多人协作创建完成")).toBeVisible();
    await expect(authedPage.getByText("创建失败")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
