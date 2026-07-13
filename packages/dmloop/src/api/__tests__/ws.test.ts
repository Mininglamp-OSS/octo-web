// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WKApp } from "@octo/base";
import { loopWs } from "../ws";

// loopWs 依赖:WKApp.mittBus(域刷新信号落点)、issueLoopCliToken(握手 token)、全局 WebSocket。
// 这里全部替身,只验 loopWs 自身的事件→刷新映射、去抖合并、on() 分发,不打真实网络。
vi.mock("@octo/base", () => ({
  WKApp: { mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
}));
vi.mock("../authApi", () => ({
  issueLoopCliToken: vi.fn(() => Promise.resolve({ token: "tok" })),
}));

// 可被测试驱动的假 WebSocket:记录 send、暴露 open()/message() 触发回调。
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { /* no-op */ }
  open() { this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const emitMock = () => (WKApp.mittBus.emit as unknown as Mock);

// 起连并推进到「已鉴权、可收事件」:start → 等 token 微任务 → onopen(发 auth) → auth_ack。
// 末尾推进过去抖窗口,把 auth_ack 自己排的那次 refresh 冲掉,让调用方从干净态开始断言。
async function connectAndAuth(slug = "ws-test") {
  loopWs.start(slug);
  await vi.advanceTimersByTimeAsync(0); // flush issueLoopCliToken() 的微任务 → 创建 socket
  const sock = FakeWebSocket.last!;
  sock.open();
  sock.message({ type: "auth_ack" });
  await vi.advanceTimersByTimeAsync(250); // 冲掉 auth_ack 排的 refresh
  return sock;
}

describe("loopWs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    FakeWebSocket.last = null;
    emitMock().mockClear();
  });
  afterEach(() => {
    loopWs.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("握手 token 作为首帧 auth 发送", async () => {
    const sock = await connectAndAuth();
    expect(sock.sent).toHaveLength(1);
    expect(JSON.parse(sock.sent[0])).toEqual({ type: "auth", payload: { token: "tok" } });
  });

  it("一串 REFRESH 事件在去抖窗口内合并成一次 wk:loop-issues-refresh", async () => {
    const sock = await connectAndAuth();
    emitMock().mockClear(); // 忽略 auth_ack 自己排的那次
    sock.message({ type: "issue:created" });
    sock.message({ type: "task:dispatch" });
    sock.message({ type: "task:running" });
    expect(emitMock()).not.toHaveBeenCalled(); // 去抖窗口内不立即发
    await vi.advanceTimersByTimeAsync(250);
    const refreshCalls = emitMock().mock.calls.filter((c) => c[0] === "wk:loop-issues-refresh");
    expect(refreshCalls).toHaveLength(1); // 三帧合并成一次
  });

  it("非看板事件(task:progress/activity:created)不触发看板刷新", async () => {
    const sock = await connectAndAuth();
    emitMock().mockClear();
    sock.message({ type: "task:progress" });
    sock.message({ type: "activity:created" });
    sock.message({ type: "agent:status" }); // presence:也不刷看板
    await vi.advanceTimersByTimeAsync(300);
    expect(emitMock().mock.calls.filter((c) => c[0] === "wk:loop-issues-refresh")).toHaveLength(0);
  });

  it("auth_ack 触发一次刷新(重连补齐)", async () => {
    loopWs.start("ws-test");
    await vi.advanceTimersByTimeAsync(0);
    const sock = FakeWebSocket.last!;
    sock.open();
    sock.message({ type: "auth_ack" });
    await vi.advanceTimersByTimeAsync(250);
    expect(emitMock().mock.calls.filter((c) => c[0] === "wk:loop-issues-refresh")).toHaveLength(1);
  });

  it("on(type) 收到原始 payload;退订后不再回调", async () => {
    const sock = await connectAndAuth();
    const h = vi.fn();
    const off = loopWs.on("task:progress", h);
    sock.message({ type: "task:progress", payload: { seq: 1 } });
    expect(h).toHaveBeenCalledWith({ seq: 1 });
    off();
    sock.message({ type: "task:progress", payload: { seq: 2 } });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("坏帧(非 JSON / 无 type)被安全丢弃,不触发刷新", async () => {
    const sock = await connectAndAuth();
    emitMock().mockClear();
    sock.onmessage?.({ data: "not-json" });
    sock.message({ type: 123 }); // type 非 string
    sock.message({ payload: {} }); // 无 type
    await vi.advanceTimersByTimeAsync(300);
    expect(emitMock().mock.calls.filter((c) => c[0] === "wk:loop-issues-refresh")).toHaveLength(0);
  });
});
