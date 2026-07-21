// @octo/loop — Agent Runtime sseClient
//
// SSE over POST：agent 跑 turn 需要 POST 请求体（prompt/参数），原生 EventSource 只支持
// GET，故用 fetch + ReadableStream 手写 SSE 解析。特性：
//   1) POST + fetch 流式读取
//   2) 逐帧解析（event/data/id/retry 字段，多行 data 拼接，空行分隔）
//   3) 断线重连（指数退避 + 上限），重连时显式注入 Last-Event-ID
//   4) 显式 Last-Event-ID：不依赖浏览器原生续推（fetch 无此语义），由本客户端手动带
//
// 帧解析拆成纯函数 SseFrameParser，便于单测覆盖乱序拼帧/半包/CRLF 等边界。

import { AGENT_RUNTIME_BASE, buildAuthHeaders } from "./httpClient";

/* ============================ 纯帧解析器 ============================ */

export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

// 增量喂入原始文本、吐出完整帧。处理半包（跨 chunk 的帧）与 CRLF/CR/LF 三种换行。
export class SseFrameParser {
  private buf = "";

  // 喂入一段原始文本，返回本次能完整解析出的帧（可能为空）。
  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    // 统一换行为 \n，便于用双换行切分事件。
    this.buf = this.buf.replace(/\r\n|\r/g, "\n");
    const frames: SseFrame[] = [];
    let sep: number;
    // SSE 以空行（\n\n）分隔事件；只切出已完整的部分，残余留在 buf。
    while ((sep = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, sep);
      this.buf = this.buf.slice(sep + 2);
      const frame = this.parseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  // 流结束时冲刷残余（末尾无空行的最后一帧）。
  flush(): SseFrame[] {
    const rest = this.buf.trim();
    this.buf = "";
    if (!rest) return [];
    const frame = this.parseBlock(rest);
    return frame ? [frame] : [];
  }

  private parseBlock(block: string): SseFrame | null {
    const lines = block.split("\n");
    const dataLines: string[] = [];
    let event: string | undefined;
    let id: string | undefined;
    let retry: number | undefined;
    let sawField = false;
    for (const line of lines) {
      if (line === "" || line.startsWith(":")) continue; // 注释行 / 空行
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      // 规范：冒号后单个前导空格要去掉。
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      switch (field) {
        case "event":
          event = value;
          sawField = true;
          break;
        case "data":
          dataLines.push(value);
          sawField = true;
          break;
        case "id":
          id = value;
          sawField = true;
          break;
        case "retry": {
          const n = Number(value);
          if (!Number.isNaN(n)) retry = n;
          sawField = true;
          break;
        }
        default:
          break; // 未知字段忽略
      }
    }
    if (!sawField) return null;
    return { event, data: dataLines.join("\n"), id, retry };
  }
}

/* ============================ 流式连接 ============================ */

export interface SseConnectOptions {
  // 请求方法，默认 POST。
  method?: string;
  // POST 请求体（如 { prompt, session_key, ... }）。
  body?: unknown;
  // 续推游标：首次连接可为空，重连时客户端自动带上最近收到的 id。
  lastEventId?: string;
  // 收到一帧。
  onFrame: (frame: SseFrame) => void;
  // 每次（重）连接建立时回调，reconnect=true 表示这是断线后的重连。
  onOpen?: (info: { reconnect: boolean; attempt: number }) => void;
  // 连接错误（含中途断流）。返回后由客户端决定是否重连。
  onError?: (err: unknown, willRetry: boolean) => void;
  // 正常收到「流结束」（服务端关闭）后回调。
  onClose?: () => void;
  // 最大重连次数，默认 5；<=0 表示不重连。
  maxRetries?: number;
  // 退避基数 ms，默认 500（第 n 次退避 = base * 2^(n-1)，上限 maxBackoffMs）。
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  // 注入的 sleep（单测可替换为立即 resolve）。
  sleep?: (ms: number) => Promise<void>;
  // 注入的 fetch（单测可替换）。
  fetchImpl?: typeof fetch;
}

export interface SseConnection {
  // 主动中断（abort 当前 turn / 组件卸载）。
  close: () => void;
  // 已完成的 promise（正常关闭 resolve；不可恢复错误 reject）。
  done: Promise<void>;
  // 当前已知的 Last-Event-ID。
  lastEventId: () => string | undefined;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 建立一条带自动重连的 SSE 连接。
export function connectSse(path: string, opts: SseConnectOptions): SseConnection {
  const {
    method = "POST",
    body,
    onFrame,
    onOpen,
    onError,
    onClose,
    maxRetries = 5,
    backoffBaseMs = 500,
    maxBackoffMs = 10_000,
    sleep = defaultSleep,
    fetchImpl = fetch,
  } = opts;

  let lastId = opts.lastEventId;
  let aborted = false;
  let controller: AbortController | null = null;

  const url = path.startsWith("http") ? path : `${AGENT_RUNTIME_BASE}${path}`;

  async function runOnce(reconnect: boolean, attempt: number): Promise<void> {
    controller = new AbortController();
    const headers = buildAuthHeaders({
      Accept: "text/event-stream",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      // 显式续推：把最近的事件 id 作为 Last-Event-ID 头带上（fetch 不会自动带）。
      ...(lastId ? { "Last-Event-ID": lastId } : {}),
    });

    const resp = await fetchImpl(url, {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`SSE connect failed: HTTP ${resp.status}`);
    }
    onOpen?.({ reconnect, attempt });

    const parser = new SseFrameParser();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const frame of parser.push(text)) {
        if (frame.id) lastId = frame.id;
        onFrame(frame);
      }
    }
    for (const frame of parser.flush()) {
      if (frame.id) lastId = frame.id;
      onFrame(frame);
    }
  }

  const done = (async () => {
    let attempt = 0;
    for (;;) {
      try {
        await runOnce(attempt > 0, attempt);
        // 正常结束（服务端关流）。
        if (!aborted) onClose?.();
        return;
      } catch (e) {
        if (aborted || (e as { name?: string })?.name === "AbortError") {
          // 主动中断：不算错误，不重连。
          return;
        }
        const willRetry = attempt < maxRetries;
        onError?.(e, willRetry);
        if (!willRetry) throw e;
        const backoff = Math.min(backoffBaseMs * 2 ** attempt, maxBackoffMs);
        attempt += 1;
        await sleep(backoff);
        if (aborted) return;
      }
    }
  })();

  return {
    close: () => {
      aborted = true;
      controller?.abort();
    },
    done,
    lastEventId: () => lastId,
  };
}
