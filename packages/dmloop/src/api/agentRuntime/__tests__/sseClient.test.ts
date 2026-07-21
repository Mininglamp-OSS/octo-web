import { describe, expect, it, vi } from "vitest";
import { SseFrameParser, connectSse } from "../sseClient";
import { setAuthTokenProvider } from "../httpClient";

describe("SseFrameParser", () => {
  it("解析单帧 event/data/id", () => {
    const p = new SseFrameParser();
    const frames = p.push("event: message\ndata: hello\nid: 7\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: "message", data: "hello", id: "7", retry: undefined });
  });

  it("多行 data 拼接（换行连接）", () => {
    const p = new SseFrameParser();
    const [f] = p.push("data: line1\ndata: line2\n\n");
    expect(f.data).toBe("line1\nline2");
  });

  it("半包：跨 push 的帧能续上", () => {
    const p = new SseFrameParser();
    expect(p.push("data: par")).toHaveLength(0);
    const frames = p.push("tial\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe("partial");
  });

  it("CRLF / CR 归一为 LF", () => {
    const p = new SseFrameParser();
    const [f] = p.push("data: a\r\ndata: b\r\n\r\n");
    expect(f.data).toBe("a\nb");
  });

  it("冒号后单个前导空格被去掉，其余保留", () => {
    const p = new SseFrameParser();
    const [f] = p.push("data:  two-leading\n\n"); // 两个空格 → 去一个留一个
    expect(f.data).toBe(" two-leading");
  });

  it("注释行(:)被忽略", () => {
    const p = new SseFrameParser();
    const [f] = p.push(": keep-alive\ndata: real\n\n");
    expect(f.data).toBe("real");
  });

  it("flush 冲刷末尾无空行的残帧", () => {
    const p = new SseFrameParser();
    expect(p.push("data: tail\n")).toHaveLength(0);
    const frames = p.flush();
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe("tail");
  });
});

// 用 chunks 构造一个可读流的 Response。
function streamResponse(chunks: string[], ok = true, status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

describe("connectSse", () => {
  it("解析流中的多帧并追踪 lastEventId", async () => {
    setAuthTokenProvider(() => "tok");
    const frames: string[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse(["data: a\nid: 1\n\n", "data: b\nid: 2\n\n"]),
    );
    const conn = connectSse("/agent/prompt", {
      body: { prompt: "hi" },
      onFrame: (f) => frames.push(f.data),
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    await conn.done;
    expect(frames).toEqual(["a", "b"]);
    expect(conn.lastEventId()).toBe("2");
    // Bearer 头注入
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("断线后重连并显式注入 Last-Event-ID 头", async () => {
    const frames: string[] = [];
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // 首次：先给一帧(id:5)再让流出错。用 pull 分两步：先投递 chunk，再 error，
        // 避免 start() 内同步 enqueue+error 导致已入队 chunk 被丢弃。
        const enc = new TextEncoder();
        let step = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (step === 0) {
              controller.enqueue(enc.encode("data: first\nid: 5\n\n"));
              step = 1;
            } else {
              controller.error(new Error("network drop"));
            }
          },
        });
        return Promise.resolve({ ok: true, status: 200, body } as unknown as Response);
      }
      // 重连：正常收尾
      return Promise.resolve(streamResponse(["data: second\nid: 6\n\n"]));
    });

    const conn = connectSse("/agent/prompt", {
      body: {},
      onFrame: (f) => frames.push(f.data),
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxRetries: 3,
    });
    await conn.done;

    expect(frames).toEqual(["first", "second"]);
    // 第二次调用应带上 Last-Event-ID: 5
    const retryHeaders = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders["Last-Event-ID"]).toBe("5");
    expect(conn.lastEventId()).toBe("6");
  });

  it("close() 主动中断不触发重连", async () => {
    // 真实 fetch 在 signal abort 时 reject AbortError；mock 照此语义。
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const conn = connectSse("/agent/prompt", {
      body: {},
      onFrame: () => {},
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    conn.close();
    await conn.done; // 应正常 resolve（AbortError 被识别为主动中断，不 reject、不重连）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
