# CH18 Chat Composer Attachment

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH18 @p1 @chat @composer @attachment`

## 目标

验证选择文件后，附件以待发送状态显示在 composer 中。

## 前置条件

- seed 一个可打开群会话。

## 用户操作步骤

1. 打开文件选择入口。
2. 选择 `E2E 附件.txt`。

## 预期结果

- composer 显示待发送附件文件名。

## 反例

- 文件选择后附件预览未出现时，不能发送该附件。

## 视觉基准

不建 pixel baseline; 用文件名断言。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx:3000-3030`
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx`
