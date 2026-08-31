# V3 Chat 语音转写失败提示

## Metadata

- Case 类型: error flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@V3 @p1 @chat @voice @transcription @error`

## 目标

验证录音停止后转写服务失败时，Chat Composer 显示可重试提示且不会回填错误文本。

## 前置条件

- fixture: `fixtures-authed`，使用 Chat mock IM。
- Per-case handler: `e2e-kit/msw-handlers/v3-chat-voice-transcription-failure.ts`
  - `GET */voice/config` 返回启用的远端语音配置。
  - `GET */voice/context` 返回空上下文。
  - `POST */voice/transcribe` 返回 HTTP 500。
- 浏览器 fixture 替换 `getUserMedia` 和 `MediaRecorder`，不依赖真实麦克风设备。

## 用户操作步骤

1. 进入有会话的 Chat。
2. 点击 Composer 的「语音输入 (长按 Shift)」入口开始录音。
3. 等待录音超过最小有效时长。
4. 点击停止录音。
5. 等待转写失败提示。

## 预期结果

- 录音中显示「语音输入」状态和停止录音入口。
- 转写失败后显示「转写失败，请重试」。
- Composer 不回填伪造的转写文本。

## 反例

- 如果录音未启动，停止录音入口不会出现，case 应失败。
- 如果转写失败没有提示，用户无法判断是否需要重试，case 应失败。

## 视觉基准

不建 pixel baseline；使用状态文案、title 和输入框值断言。

## 摸清依据

- `packages/dmworkbase/src/features/chat-composer/adapters/voice/useVoiceInput.ts:620-664`: 转写失败时显示错误 Toast。
- `packages/dmworkbase/src/Components/VoiceInputButton/index.tsx:374-427`: 录音与停止入口渲染。
- `packages/dmworkbase/src/Service/VoiceService.ts:55-104`: 转写接口。
