# CH20 Chat Channel Search

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH20 @p1 @chat @search`

## 目标

验证群会话可以打开会话内搜索面板。

## 前置条件

- chat baseline 开启 messages search。
- seed 一个群会话。

## 用户操作步骤

1. 打开群会话。
2. 点击「查找聊天内容」。

## 预期结果

- 显示会话内搜索面板和「输入关键字搜索」输入框。

## 反例

- 搜索开关关闭或入口事件未触发时，搜索面板不可见。

## 视觉基准

不建 pixel baseline; 用面板 class 和 placeholder 断言。

## 摸清依据

- `packages/dmworkbase/src/features/channelSearch/ChatSearchEntryButton.tsx:18-29`
- `packages/dmworkbase/src/features/channelSearch/ChannelSearchPanel.tsx:295-333`
- `packages/dmworkbase/src/features/channelSearch/feature.ts:5-14`
