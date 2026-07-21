import { describe, expect, it } from "vitest";
import {
  initialStreamState,
  reduceEvent,
  reduceAll,
  markAborted,
  reconcileMissing,
} from "../streamReducer";
import type { AgentEvent } from "../../api/agentRuntime/contracts";

const ev = (e: Partial<AgentEvent> & { type: AgentEvent["type"] }): AgentEvent => e;

describe("streamReducer — 基本归约", () => {
  it("拼接 message_delta 成一条消息", () => {
    const s = reduceAll([
      ev({ type: "message_delta", seq: 0, messageId: "m1", text: "Hel" }),
      ev({ type: "message_delta", seq: 1, messageId: "m1", text: "lo" }),
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toBe("Hello");
    expect(s.phase).toBe("acting");
  });

  it("tool_call → tool_result 归约为一行并置 done", () => {
    const s = reduceAll([
      ev({ type: "tool_call", seq: 0, toolCallId: "t1", toolName: "read", input: { path: "a.ts" } }),
      ev({ type: "tool_result", seq: 1, toolCallId: "t1", output: "content" }),
    ]);
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0].status).toBe("done");
    expect(s.toolCalls[0].name).toBe("read");
    expect(s.toolCalls[0].output).toBe("content");
  });

  it("thinking 只在 full 档由 UI 展示，但归约器始终收集", () => {
    const s = reduceAll([ev({ type: "thinking", seq: 0, messageId: "r1", text: "reason" })]);
    expect(s.thinking).toHaveLength(1);
    expect(s.phase).toBe("thinking");
  });

  it("done 事件置 finalized + done 相位", () => {
    const s = reduceAll([
      ev({ type: "message", seq: 0, messageId: "m1", text: "hi" }),
      ev({ type: "done", seq: 1 }),
    ]);
    expect(s.finalized).toBe(true);
    expect(s.phase).toBe("done");
  });
});

describe("streamReducer — 乱序", () => {
  it("低 seq 后到时按 seq 插到正确位置", () => {
    const s = reduceAll([
      ev({ type: "message", seq: 2, messageId: "m2", text: "second" }),
      ev({ type: "message", seq: 0, messageId: "m0", text: "zero" }),
      ev({ type: "message", seq: 1, messageId: "m1", text: "first" }),
    ]);
    expect(s.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });

  it("tool_result 先于 tool_call 到达（乱序）：先占位，调用帧补齐 name/input", () => {
    const s = reduceAll([
      ev({ type: "tool_result", seq: 5, toolCallId: "t1", output: "out" }),
      ev({ type: "tool_call", seq: 4, toolCallId: "t1", toolName: "grep", input: { q: "x" } }),
    ]);
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0].name).toBe("grep");
    expect(s.toolCalls[0].output).toBe("out");
    expect(s.toolCalls[0].status).toBe("done");
  });
});

describe("streamReducer — 重连去重", () => {
  it("相同 seq 事件重复到达时幂等（不重复追加文本）", () => {
    let s = initialStreamState();
    const delta = ev({ type: "message_delta", seq: 0, messageId: "m1", text: "Hi" });
    s = reduceEvent(s, delta);
    s = reduceEvent(s, delta); // 重连回放：同一帧再来一次
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toBe("Hi");
  });

  it("无 seq 但有 id 的事件也能去重", () => {
    let s = initialStreamState();
    const e = ev({ type: "tool_call", id: "abc", toolCallId: "t1", toolName: "ls" });
    s = reduceEvent(s, e);
    s = reduceEvent(s, e);
    expect(s.toolCalls).toHaveLength(1);
  });

  it("重连续推补齐后续增量，历史不丢", () => {
    let s = reduceAll([
      ev({ type: "message_delta", seq: 0, messageId: "m1", text: "Hel" }),
      ev({ type: "message_delta", seq: 1, messageId: "m1", text: "lo" }),
    ]);
    // 模拟断线重连：seq 0/1 回放（去重）+ 新 seq 2
    s = reduceEvent(s, ev({ type: "message_delta", seq: 0, messageId: "m1", text: "Hel" }));
    s = reduceEvent(s, ev({ type: "message_delta", seq: 2, messageId: "m1", text: "!" }));
    expect(s.messages[0].text).toBe("Hello!");
  });
});

describe("streamReducer — 中断", () => {
  it("markAborted 后迟到的 message_delta 不再改写", () => {
    let s = reduceAll([ev({ type: "message_delta", seq: 0, messageId: "m1", text: "partial" })]);
    s = markAborted(s);
    expect(s.phase).toBe("aborted");
    expect(s.finalized).toBe(true);
    const before = s.messages[0].text;
    s = reduceEvent(s, ev({ type: "message_delta", seq: 1, messageId: "m1", text: " more" }));
    expect(s.messages[0].text).toBe(before); // 未追加
    expect(s.phase).toBe("aborted"); // 相位不被 late 帧改写
  });

  it("error 事件置 error 终态，done 不会覆盖成 done", () => {
    let s = reduceAll([ev({ type: "error", seq: 0, errorMessage: "boom" })]);
    expect(s.phase).toBe("error");
    expect(s.errorMessage).toBe("boom");
    s = reduceEvent(s, ev({ type: "done", seq: 1 }));
    expect(s.phase).toBe("error");
  });
});

describe("streamReducer — 对账丢帧", () => {
  it("服务端 last_seq 超过本地 maxSeq 时置 maybeMissingEvents", () => {
    const s = reduceAll([ev({ type: "message", seq: 3, messageId: "m", text: "x" })]);
    expect(reconcileMissing(s, 10).maybeMissingEvents).toBe(true);
    expect(reconcileMissing(s, 3).maybeMissingEvents).toBe(false);
    expect(reconcileMissing(s, undefined).maybeMissingEvents).toBe(false);
  });
});
