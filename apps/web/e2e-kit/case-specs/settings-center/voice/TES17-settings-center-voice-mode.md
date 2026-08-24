# TES17 设置说话方式后的语音交互提示

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@TES17 @p1 @settings-center @voice @chat @interaction`

## 目标

验证设置中心切换说话方式后，语音设置页的用户可见操作说明同步变化，保证 toggle 与 hold 的交互契约没有混淆。

## 前置条件

- fixture: `fixtures-authed`，预置已同意且已启用的语音输入配置。
- 通过 mock IM seed 提供一个可打开的群聊。
- 不执行真实麦克风录音或提交语音数据；本 case 只验证真实页面显示的交互说明。

## 用户操作步骤

1. 打开设置中心的“语音输入”页面。
2. 选择“点按”说话方式。
3. 观察语音输入说明。
4. 将说话方式改为“长按”。
5. 再次观察语音输入说明。

## 预期结果

- 点按模式说明包含“点按右 Alt 开始语音输入，再按一次结束”。
- 长按模式说明包含“按住右 Alt 进行语音输入，松开结束”。
- 两种模式切换后页面都保持在语音输入设置页，无错误提示。

## 反例

- 长按模式不应继续显示“再按一次结束”。
- 点按模式不应显示“松开结束”。

## 视觉基准

不建 pixel baseline; 使用设置页内可见说明文本断言。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:338-348`: `voiceDescription` 根据 `speakingMode` 选择 toggle/hold 文案。
- `packages/dmworkbase/src/Service/VoiceSettingsStore.ts:1-9,89-103`: 说话方式类型及订阅更新。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:1425-1427`: 点按、长按语音说明文案。
