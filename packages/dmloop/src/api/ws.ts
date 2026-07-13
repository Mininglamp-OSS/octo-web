// @octo/loop 实时 WebSocket 客户端:订阅 workspace 事件驱动看板/面板刷新。
// token-mode 握手(浏览器 WS 不能设 header):连上后首帧 {type:"auth",payload:{token}},
// token 取自 /cli-token。dev 经 vite `/fleet/ws` → 后端 /ws;VITE_FLEET_WS_URL 可覆盖直连。
import { WKApp } from "@octo/base";
import { issueLoopCliToken } from "./authApi";

// 重连退避:base 起步、指数封顶,带抖动——避免 backend 重启后众客户端齐步重连、也避免死循环打满。
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
// 一次派单连发多帧(issue:created→task:dispatch→…),去抖合并成一次看板重取。
const REFRESH_DEBOUNCE_MS = 250;

// 触发看板重取的事件。不含 task:progress/activity:created(高频、只关 transcript)、
// agent:status(presence)——后者由 SquadDetailPage 经 on() 单订。
const REFRESH_EVENTS = new Set([
  "issue:created",
  "issue:updated",
  "issue:deleted",
  "task:dispatch",
  "task:queued",
  "task:running",
  "task:completed",
  "task:failed",
]);

function wsUrl(slug: string): string {
  const base = (import.meta as { env?: Record<string, string> }).env?.VITE_FLEET_WS_URL;
  const q = `?workspace_slug=${encodeURIComponent(slug)}&client_platform=web`;
  if (base) return `${base.replace(/\/$/, "")}/ws${q}`;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/fleet/ws${q}`;
}

// 单例:LoopPage 按 workspace start/stop。看板等域级刷新订全局 `wk:loop-issues-refresh`;
// transcript/presence 等高频原始事件用 on(type) 精确订。
class LoopWs {
  private ws: WebSocket | null = null;
  private slug = "";
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private refreshTimer: number | null = null;
  private stopped = true;
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on(type: string, handler: (payload: unknown) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
    return () => { this.handlers.get(type)?.delete(handler); };
  }

  start(slug: string): void {
    if (!slug) { this.stop(); return; }
    if (!this.stopped && this.slug === slug) return;
    this.stop();
    this.slug = slug;
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.slug = "";
    this.reconnectAttempts = 0;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    if (this.ws) {
      // 先摘全部回调再 close,避免主动断开触发重连、或在途帧影响新上下文。
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      try { this.ws.close(); } catch { /* already closing */ }
      this.ws = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      WKApp.mittBus.emit("wk:loop-issues-refresh");
    }, REFRESH_DEBOUNCE_MS);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    const slug = this.slug;
    let token: string;
    try {
      token = (await issueLoopCliToken()).token;
    } catch {
      this.scheduleReconnect();
      return;
    }
    // 取 token 期间可能已 stop/切 workspace。
    if (this.stopped || slug !== this.slug) return;

    // 构造也可能同步抛(如 VITE_FLEET_WS_URL 畸形),不裹会逃出 open() 不排重连 → 单例僵死。
    let ws: WebSocket;
    try { ws = new WebSocket(wsUrl(slug)); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws === ws) ws.send(JSON.stringify({ type: "auth", payload: { token } }));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return; // 已被切换/stop 取代的旧 socket 排队帧不得影响新上下文
      let msg: { type?: unknown; payload?: unknown };
      try { msg = JSON.parse(typeof e.data === "string" ? e.data : ""); } catch { return; }
      if (!msg || typeof msg.type !== "string") return;
      // auth_ack:(重)连成功。重置退避计数,并刷新一次补齐断连期漏掉的变更。
      if (msg.type === "auth_ack") { this.reconnectAttempts = 0; this.scheduleRefresh(); return; }
      if (REFRESH_EVENTS.has(msg.type)) this.scheduleRefresh();
      const hs = this.handlers.get(msg.type);
      if (hs) for (const h of hs) { try { h(msg.payload); } catch { /* handler 自负 */ } }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose 负责重连 */ };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    // 指数退避封顶 + 抖动([capped/2, capped)):backend 重启众客户端不齐步,持续失败也不打满。
    const capped = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    const delay = capped / 2 + Math.random() * (capped / 2);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }
}

export const loopWs = new LoopWs();
