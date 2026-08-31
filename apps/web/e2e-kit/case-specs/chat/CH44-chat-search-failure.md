# CH44: Chat 会话搜索失败提示

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH44 @p1 @chat @search @failure`

## 目标

验证会话内搜索请求失败时，搜索面板展示明确错误提示，而不是误报为空结果。

## 前置条件

- 使用 mock IM runtime seed 一个群会话。
- Per-case handler `e2e-kit/msw-handlers/ch44-chat-search-failure.ts`：消息搜索接口返回 500。

## 用户操作步骤

1. 打开群会话内搜索。
2. 输入关键字「失败搜索」。

## 预期结果

- 搜索面板显示「搜索失败，请稍后重试」。
- 不显示「暂无匹配结果」作为错误请求的替代状态。

## 反例

- 搜索接口失败时展示空结果，用户无法区分“没有消息”和“搜索失败”。

## 视觉基准

不建 pixel baseline；用搜索面板中的用户可见文案断言。

## 摸清依据

- `packages/dmworkbase/src/features/channelSearch/ChannelSearchPanel.tsx:160-177,237-248`: 搜索失败且无结果时渲染 error 文案。
- `packages/dmworkbase/src/features/channelSearch/ChannelSearchPanel.tsx:330-385`: 搜索入口、面板和结果区域。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:117-119`: 空结果与搜索失败文案。
