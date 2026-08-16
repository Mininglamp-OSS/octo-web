/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S2-summary-empty-create-entry.md
 *
 * S2: Summary 空态 → 创建页入口.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS2SummaryEmptyCreateEntry } from "../../../msw-handlers/s2-summary-empty-create-entry";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S2 @p1 @summary @list @summary-list @summary-create S2 — Summary 空态创建入口", () => {
  test("从空态进入 Summary 创建页", async ({ authedPage }) => {
    await registerS2SummaryEmptyCreateEntry(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(
      authedPage.getByRole("heading", { name: "智能总结" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible();
    await expect(
      authedPage.getByText("快速生成群聊或个人工作总结，让 AI 帮你梳理重要信息")
    ).toBeVisible();
    await expect(authedPage.getByText("已完成", { exact: true })).toHaveCount(0);
    await expect(authedPage.getByText("失败", { exact: true })).toHaveCount(0);

    await expect(authedPage.getByTestId(T.createEntry)).toContainText("创建第一份总结");
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByTestId(T.createTopic)).toBeVisible();
    await expect(authedPage.getByTestId(T.createTopic)).toHaveAttribute(
      "placeholder",
      "请输入你想总结的主题，例如：总结本周项目进展、整理客户反馈要点"
    );

    await sanityCheck(authedPage, ctx);
  });
});
