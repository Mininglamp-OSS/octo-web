/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/create/S5-summary-create-basic.md
 *
 * S5: Summary 选择聊天 + 输入主题 + 创建成功.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS5SummaryCreateBasic } from "../../../msw-handlers/s5-summary-create-basic";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S5 @p1 @summary @create @summary-create S5 — Summary 创建主流程", () => {
  test("选择聊天并输入主题后创建总结", async ({ authedPage }) => {
    await registerS5SummaryCreateBasic(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });
    const startButton = authedPage.getByTestId(T.createSubmit);
    await expect(startButton).toBeDisabled();

    await authedPage.getByTestId(T.createSelectChat).click();
    await expect(authedPage.getByText("选择聊天").last()).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.chatSelectorAllGroupsTab).click();
    await authedPage.getByText("S5 项目群", { exact: true }).click();
    await expect(authedPage.getByText("已选 1 / 30")).toBeVisible();
    await authedPage.getByTestId(T.chatSelectorConfirmBtn).click();

    await expect(authedPage.getByText("S5 项目群", { exact: true })).toBeVisible();
    await authedPage
      .getByTestId(T.createTopic)
      .fill("S5 项目复盘总结");
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(authedPage.getByText("总结任务已创建")).toBeVisible({ timeout: 15_000 });
    await expect(
      authedPage.getByRole("heading", { name: "S5 项目复盘总结", level: 2 })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S5 创建流程已完成")).toBeVisible();
    await expect(authedPage.getByText("创建失败")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
