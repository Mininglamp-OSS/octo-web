# TES18 语音设置刷新后仍作用于对话

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@TES18 @p1 @settings-center @voice @chat @persistence`

## 目标

验证修改后的语音快捷键和说话方式在关闭设置、刷新页面并重新打开会话后仍被恢复，并继续影响对话输入 placeholder。

## 前置条件

- fixture: `fixtures-authed`，预置可打开的群聊和已同意的语音配置。
- voice settings 使用当前 e2e 用户作用域的 localStorage 持久化。
- 不断言 localStorage 内容或请求 body，只观察刷新后的页面表现。

## 用户操作步骤

1. 在设置中心“语音输入”中选择“左 Shift”和“长按”。
2. 关闭设置中心，确认对话输入框 placeholder 为“发送给 TES18 持久化群”，快捷键标签显示“按住左 Shift 进行语音输入”。
3. 刷新页面并重新打开同一个群聊。
4. 观察输入框 placeholder。

## 预期结果

- 刷新前输入框 placeholder 和快捷键标签均正确显示。
- 刷新后重新进入同一会话，placeholder 和快捷键标签仍正确显示。
- 设置中心重新打开时仍显示“左 Shift”和“长按”。

## 反例

- 刷新后恢复为默认“右 Alt/点按”时，本 case 应失败。
- 刷新后设置页显示新值但对话 placeholder 或快捷键标签恢复旧值时，本 case 应失败。

## 视觉基准

不建 pixel baseline; 用可观察的设置值和输入框 placeholder 断言。

## 摸清依据

- `packages/dmworkbase/src/Service/VoiceSettingsStore.ts:17-30,65-80`: 用户作用域 key、默认值和 localStorage 读取。
- `packages/dmworkbase/src/Service/VoiceSettingsStore.ts:89-123`: 写入、订阅和按用户切换恢复。
- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:338-348`: 设置页消费并展示持久化后的值。
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx`: 对话 placeholder 和快捷键标签根据恢复后的设置重算。
