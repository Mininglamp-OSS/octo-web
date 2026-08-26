# V1 Chat Composer 语音入口启用

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@V1 @p1 @chat @voice`

## 目标

验证语音输入配置启用后，Chat Composer 显示可用的语音输入入口，并且入口不是禁用态。

本 case 先守护最基础、稳定的用户可观察能力；真实录音、停止录音和转写回填作为后续子 case，避免浏览器媒体设备替身不稳定影响基础 Chat 门禁。

## 前置条件

- fixture: `fixtures-authed`，使用 Chat mock IM。
- Per-case MSW handler: `e2e-kit/msw-handlers/v1-chat-voice-input.ts`
- Per-case handler 仅在 `sessionStorage.__e2e_scenario=v1-chat-voice-input` 时返回启用的语音配置。
- 使用 Chat mock IM runtime 准备一个可打开的会话。

## 用户操作步骤

1. 进入有会话的 Chat。
2. 观察 Chat Composer 的语音输入入口。

## 预期结果

- Composer 显示语音输入入口。
- 入口 title 为「语音输入 (长按 Shift)」，并且入口可见，表示当前配置已启用且网络能力可用。

## 反例

- 未启用语音配置时不应显示可用语音入口。
- 录音和转写失败分支由后续语音交互 case 覆盖。

## 视觉基准

不建 pixel baseline；使用按钮状态、状态提示和输入框内容断言结构。

## 摸清依据

- `packages/dmworkbase/src/features/chat-composer/ui/voice/VoiceInputIndicator.tsx:90-160`: 录音、转写状态与回填回调。
- `packages/dmworkbase/src/features/chat-composer/ui/voice/VoiceInputIndicator.tsx:284-362`: 快捷键与录音启动逻辑。
- `packages/dmworkbase/src/features/chat-composer/adapters/voice/useVoiceInput.ts`: MediaRecorder、转写和结果回调。
