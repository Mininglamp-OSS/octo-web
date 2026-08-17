/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/agent/S9-summary-agent-chat-save.md
 *
 * S9: Summary Agent 总结 chat → 保存为总结 → 详情.
 */
import { test, expect } from "../../../fixtures-authed";
import { installMockImRuntime } from "../../../_kit/mock-im-runtime";
import { registerS9SummaryAgentChatSave } from "../../../msw-handlers/s9-summary-agent-chat-save";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S9 @p0 @summary @agent @summary-agent @summary-create @summary-detail S9 — Summary Agent 总结保存主流程", () => {
  test("Agent 对话产出保存为总结后进入详情", async ({ authedPage }) => {
    await registerS9SummaryAgentChatSave(authedPage);
    // 提供 S9 群与成员，用于验证「选参与者后切 Agent → 保存不带 participants」（P1 回归）。
    await installMockImRuntime(authedPage, {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [
        { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
        { uid: "s9-member-a", name: "S9 Alice", robot: 0 },
      ],
      groups: [{ group_no: "s9-agent-project-group", name: "S9 Agent 项目群" }],
      conversations: [{ channelId: "s9-agent-project-group", channelType: 2, unread: 0 }],
      subscribers: [
        { uid: "e2e-user-1", name: "E2E Tester", channelId: "s9-agent-project-group", channelType: 2, role: 1, robot: 0 },
        { uid: "s9-member-a", name: "S9 Alice", channelId: "s9-agent-project-group", channelType: 2, role: 0, robot: 0 },
      ],
    });
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });

    // 正常模式：选聊天 + 选参与者（随后切 Agent 验证参与者被隔离，P1 回归）。
    await authedPage.getByTestId(T.createSelectChat).click();
    await authedPage.getByTestId(T.chatSelectorAllGroupsTab).click();
    await authedPage.getByText("S9 Agent 项目群", { exact: true }).click();
    await expect(authedPage.getByText("已选 1 / 30")).toBeVisible();
    await authedPage.getByTestId(T.chatSelectorConfirmBtn).click();
    await expect(authedPage.getByText("S9 Agent 项目群", { exact: true })).toBeVisible();

    await authedPage.getByTestId(T.createSelectMembers).click();
    await expect(authedPage.getByText("选择参与者").last()).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S9 Alice", { exact: true }).click();
    await expect(authedPage.getByText("已选 1 / 30")).toBeVisible();
    await authedPage.getByTestId(T.memberSelectorConfirmBtn).click();
    await expect(authedPage.getByText("S9 Alice", { exact: true })).toBeVisible();

    // dropdown 反映当前模式（normal active），再切到 Agent。
    await authedPage.getByTestId(T.createModeSwitch).click();
    await expect(authedPage.getByTestId(T.createNormalTab)).toHaveClass(/active/);
    await authedPage.getByTestId(T.createAgentTab).click();

    // Agent 模式：参与者入口与「开始总结」主按钮均消失。
    await expect(authedPage.getByTestId(T.createSelectMembers)).toHaveCount(0);
    await expect(authedPage.getByTestId(T.createSubmit)).toHaveCount(0);

    // Agent → Normal 往返：selectedMembers 不再被清空，切回后参与者 chips 保留（P1-2）。
    await authedPage.getByTestId(T.createModeSwitch).click();
    await authedPage.getByTestId(T.createNormalTab).click();
    await expect(authedPage.getByText("S9 Alice", { exact: true })).toBeVisible();
    await authedPage.getByTestId(T.createModeSwitch).click();
    await authedPage.getByTestId(T.createAgentTab).click();

    await expect(
      authedPage.getByText("你好，我是总结助手，想总结什么尽管告诉我。")
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.agentNewSessionBtn)).toBeVisible();
    await expect(authedPage.getByTestId(T.agentNewSessionBtn)).toContainText("新会话");
    await expect(authedPage.getByTestId(T.agentSaveBtn)).toHaveCount(0);

    await authedPage.getByTestId(T.agentInput).fill("S9 总结项目风险和下周计划");
    await authedPage.getByTestId(T.agentSendBtn).click();

    await expect(authedPage.getByText("S9 总结项目风险和下周计划")).toBeVisible();
    await expect(authedPage.getByText("S9 Agent 已整理项目风险和下周计划")).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByTestId(T.agentSaveBtn)).toBeVisible();

    await authedPage.getByTestId(T.agentSaveBtn).click();
    const saveDialog = authedPage.getByTestId(T.agentSaveDialog);
    await expect(saveDialog).toBeVisible();
    await expect(saveDialog.getByRole("heading", { name: "保存为总结" })).toBeVisible();
    await expect(authedPage.getByTestId(T.agentSaveTitleInput)).toHaveAttribute(
      "placeholder",
      "为这份总结起个标题"
    );
    await authedPage.getByTestId(T.agentSaveTitleInput).fill("S9 Agent 风险总结");
    await authedPage.getByTestId(T.agentSaveConfirmBtn).click();

    // P1 回归：Agent 保存不携带 participants（payload 边界守卫 mode !== 'agent'）。
    // selectedMembers 不再被清空——往返切换后选择仍保留（见上方 Agent→Normal 断言）。
    await expect(authedPage.getByText("AI 总结已保存")).toBeVisible({ timeout: 15_000 });
    const saveBody = await authedPage.evaluate(
      () => (window as unknown as { __s9State__?: { saveBody: unknown } }).__s9State__?.saveBody
    );
    expect(saveBody).not.toBeNull();
    expect((saveBody as { participants?: unknown }).participants).toBeUndefined();
    await expect(
      authedPage.getByTestId(T.detailTitle)
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S9 Agent 风险总结");
    await expect(authedPage.getByText("AI 摘要")).toBeVisible();
    await expect(authedPage.getByText("S9 Agent 总结已保存")).toBeVisible();
    await expect(authedPage.getByText("风险项需要提前暴露")).toBeVisible();
    await expect(authedPage.getByText("创建失败")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
