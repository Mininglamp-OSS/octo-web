# X1 Chat 与 Summary Panel 返回链路

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture, mock IM runtime
- 优先级: P1
- Tags: `@X1 @p1 @cross-module @chat @summary @deep-link`

## 目标

验证用户从 Chat 进入当前会话的 Summary 历史详情后，可以通过 panel 内返回入口回到历史列表，且仍保持在原 Chat 上下文中。

## 前置条件

- fixture: `fixtures-authed`，Space 为 `e2e-space-001`。
- mock-im-runtime seed: 复用 `s22-project-group` / `S22 项目群`，作为当前会话。
- Per-case handler: `e2e-kit/msw-handlers/x1-cross-module-chat-summary-return.ts`
  - 复用 Summary Panel 历史和详情的稳定响应结构。

## 用户操作步骤

1. 进入 Chat 并打开 `S22 项目群`。
2. 点击聊天 header 的「智能总结」入口。
3. 点击历史总结进入内嵌详情。
4. 点击详情中的「返回」。

## 预期结果

- Summary Panel 显示历史总结 `S22 聊天内总结`。
- 进入详情后显示正文 `S22 聊天内详情正文` 和「返回」入口。
- 点击返回后重新显示「聊天内的智能总结」历史列表。
- Chat 仍显示 `S22 项目群`，未跳转到全局 Summary 列表或登录页。

## 反例

- 返回后若关闭了 Summary Panel 或进入全局 Summary 列表，历史列表和当前 Chat 上下文断言会失败。
- 返回后若显示其它会话的总结，当前会话标题和总结标题不会同时匹配。

## 视觉基准

不建 pixel baseline；使用 panel 标题、返回入口、正文和当前会话名称断言结构。

## 摸清依据

- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:174-215`: panel 在历史列表与内嵌详情之间切换。
- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:98-111`: 详情返回操作恢复历史列表视图。
- `packages/dmworkbase/src/Pages/Chat/index.tsx:1285`: Chat 宿主挂载 Summary Panel 并保持当前会话。
- `packages/dmworksummary/src/components/ChatSummaryStarButton.tsx:74-116`: 当前 channel 有历史总结时打开历史 panel。
