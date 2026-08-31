# V2 Chat 语音录音转写回填

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@V2 @p1 @chat @voice @transcription`

## 目标

验证浏览器媒体能力替身下，用户可以从 Chat Composer 开始录音、停止录音并将服务端转写结果回填到输入框。

## 前置条件

- fixture: `fixtures-authed`，使用 Chat mock IM。
- Per-case handler: `e2e-kit/msw-handlers/v2-chat-voice-record-transcribe.ts`
  - `GET */voice/config` 返回启用的远端语音配置。
  - `GET */voice/context` 返回空上下文。
  - `POST */voice/transcribe` 返回转写文本「V2 语音转写结果」。
- 浏览器 fixture 替换 `getUserMedia` 和 `MediaRecorder`，不依赖真实麦克风设备。

## 用户操作步骤

1. 进入有会话的 Chat。
2. 点击 Composer 的「语音输入 (长按 Shift)」入口开始录音。
3. 等待录音超过最小有效时长。
4. 点击停止录音。
5. 等待转写完成。

## 预期结果

- 录音中显示「语音输入」状态和停止录音入口。
- 停止后显示转写中状态。
- 转写完成后，Composer 输入框显示「V2 语音转写结果」。

## 反例

- 如果录音未启动，停止录音入口不会出现，case 应失败。
- 如果转写结果没有回填输入框，用户无法继续编辑或发送，case 应失败。
- 全程不应跳转登录页或显示麦克风权限错误。

## 视觉基准

不建 pixel baseline；使用用户可见状态文案、title 和输入框值断言。

## 摸清依据

- `packages/dmworkbase/src/Components/VoiceInputButton/index.tsx:374-427`: 录音与转写状态渲染及停止入口。
- `packages/dmworkbase/src/features/chat-composer/adapters/voice/useVoiceInput.ts:357-450`: `getUserMedia`、`MediaRecorder` 和录音生命周期。
- `packages/dmworkbase/src/features/chat-composer/adapters/voice/useVoiceInput.ts:456-655`: 停止录音、调用转写服务和回填回调。
- `packages/dmworkbase/src/Service/VoiceService.ts:55-104`: 语音配置和转写接口。
