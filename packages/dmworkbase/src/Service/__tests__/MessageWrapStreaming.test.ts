// @vitest-environment jsdom
//
// octo-web#300 regression — Web 端 Bot 消息气泡内多出「空白输入框/光标」。
//
// 根因：MessageWrap.isStreaming 旧逻辑为 `streamOn && streamFlag !== END`。
// streamFlag 只在直播推流期间由 Conversation VM 临时写到 message 上，不随历史
// 消息持久化——历史消息重载后 streamFlag 为 undefined，`undefined !== END` 恒真，
// 于是每条已结束 / 历史的流式 Bot 回复都被误判为「流式中」，MarkdownContent
// 便持续渲染 `.wk-stream-cursor` 闪烁光标（占位气泡看起来像空白输入框）。
//
// 修复后：isStreaming 仅在 streamFlag 为 START / ING 时为真。本测试锁定该边界。

import { describe, expect, it, vi } from "vitest";
import { StreamFlag } from "wukongimjssdk";

// Model.tsx 在模块加载期静态 import 了一批依赖（App / EmojiService / TypingManager
// / SpaceService 等），其中只有类型 / 方法级引用，isStreaming 本身不依赖它们。
// 这里给出最小桩，避免拉起整条 App 依赖链。
vi.mock("../../App", () => ({ default: {} }));

import { MessageWrap } from "../Model";

function wrapStreamMessage(fields: {
  streamOn?: boolean;
  streamFlag?: number;
  text?: string;
}) {
  const message: any = {
    messageSeq: 1,
    streamOn: fields.streamOn ?? true,
    streamFlag: fields.streamFlag,
    content: { text: fields.text ?? "" },
  };
  return new MessageWrap(message as any);
}

describe("MessageWrap.isStreaming — octo-web#300 stray cursor", () => {
  it("历史/重载消息（streamFlag 缺失）不算流式中，避免残留光标", () => {
    // 复现场景：streamOn 由持久化的 setting 位得到 → true；streamFlag 未持久化 → undefined。
    expect(wrapStreamMessage({ streamOn: true, streamFlag: undefined }).isStreaming).toBe(false);
  });

  it("已结束的流式消息（END）不算流式中", () => {
    expect(wrapStreamMessage({ streamOn: true, streamFlag: StreamFlag.END }).isStreaming).toBe(false);
  });

  it("进行中的流式消息（START / ING）仍算流式中", () => {
    expect(wrapStreamMessage({ streamOn: true, streamFlag: StreamFlag.START }).isStreaming).toBe(true);
    expect(wrapStreamMessage({ streamOn: true, streamFlag: StreamFlag.ING }).isStreaming).toBe(true);
  });

  it("非流式消息永远不算流式中", () => {
    expect(wrapStreamMessage({ streamOn: false, streamFlag: StreamFlag.ING }).isStreaming).toBe(false);
  });
});
