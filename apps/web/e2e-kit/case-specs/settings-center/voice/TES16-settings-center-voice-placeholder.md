# TES16 设置语音后对话输入提示同步

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@TES16 @p1 @settings-center @voice @chat @consumer`

## 目标

验证用户在设置中心修改语音快捷键和说话方式后，返回对话页面时输入框 placeholder 立即反映新配置，确保设置中心与对话输入组件消费同一份状态。

## 前置条件

- fixture: `fixtures-authed`，本地模式使用 `E2E_TARGET=local`。
- 通过 mock IM seed 提供一个可打开的群聊。
- 通过用户作用域的 voice settings localStorage seed 预置已同意的语音输入配置，避免进入麦克风同意页。
- 不需要 case-specific HTTP handler。

## 用户操作步骤

1. 打开一个群聊，确认输入框可见。
2. 打开设置中心，进入“语音输入”。
3. 将“快捷键”改为“左 Shift”，将“说话方式”改为“长按”。
4. 关闭设置中心，回到刚才的群聊。
5. 观察输入框的提示文字。

## 预期结果

- 语音设置页面显示快捷键为“左 Shift”、说话方式为“长按”。
- 返回群聊后，输入框 placeholder 为“发送给 TES16 语音设置群”，并在同一行显示独立标签“按住左 Shift 进行语音输入”。
- 输入框有文字时快捷键标签隐藏，清空后恢复。
- 不出现“设置未保存”或加载失败提示。

## 反例

- 若 ChatComposer 未订阅 voice settings store，返回群聊后快捷键标签不会同步更新。
- 若标签没有从 placeholder 拆出，或 hold/toggle 映射错误，该结果不应通过本 case。

## 视觉基准

不建 pixel baseline; 用 `getByRole`、`getByPlaceholder` 和可观察文本断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:338-348`: 语音设置页面渲染快捷键、说话方式下拉框并写入 `voiceSettingsStore`。
- `packages/dmworkbase/src/Service/VoiceSettingsStore.ts:89-103`: 设置更新通知订阅者并持久化。
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:596-598`: ChatComposer 订阅 `voiceSettingsStore`。
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:620-647`: placeholder 随 voice settings 重算。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json`: placeholder 与快捷键标签文案。
