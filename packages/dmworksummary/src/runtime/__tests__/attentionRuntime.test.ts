import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Publisher = ((count: number, sampleAt: number) => void) | null;
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  refresh: vi.fn(),
  setBadge: vi.fn(),
  acceptRemote: vi.fn(),
  setPublisher: vi.fn<(publisher: Publisher) => void>(),
  setExternal: vi.fn<(cb: unknown) => void>(),
  clearExternal: vi.fn<() => void>(),
  applyExternal: vi.fn<(count: number | null) => void>(),
  isExternal: vi.fn<() => boolean>().mockReturnValue(false),
  subscribeExternal: vi.fn<() => () => void>().mockReturnValue(() => {}),
  invalidate: vi.fn(),
  events: new Map<string, Set<() => void>>(),
  addMessageListener: vi.fn(),
  removeMessageListener: vi.fn(),
  addConnectStatusListener: vi.fn(),
  removeConnectStatusListener: vi.fn(),
}));
vi.mock("@octo/base", () => ({
  getSessionSid: () => "session",
  WKApp: {
    loginInfo: { uid: "user" },
    shared: { currentSpaceId: "space" },
    mittBus: {
      on(event: string, handler: () => void) {
        const handlers = mocks.events.get(event) ?? new Set();
        handlers.add(handler);
        mocks.events.set(event, handlers);
      },
      off: (event: string, handler: () => void) => mocks.events.get(event)?.delete(handler),
      emit: (event: string) => mocks.events.get(event)?.forEach((handler) => handler()),
    },
  },
}));
vi.mock("wukongimjssdk", () => ({
  default: {
    shared: () => ({
      chatManager: {
        addMessageListener: mocks.addMessageListener,
        removeMessageListener: mocks.removeMessageListener,
      },
      connectManager: {
        addConnectStatusListener: mocks.addConnectStatusListener,
        removeConnectStatusListener: mocks.removeConnectStatusListener,
      },
    }),
  },
  ConnectStatus: { Connected: 1 },
}));
vi.mock("../../features/summaryWorkbench/availability", () => ({
  summaryWorkbenchAvailability: { invalidate: mocks.invalidate },
}));
vi.mock("../../utils/summaryAttentionBadge", () => ({
  readSummaryAttentionCount: mocks.read,
  refreshSummaryAttentionBadge: mocks.refresh,
  getSummaryAttentionBadge: () => 4,
  setSummaryAttentionBadge: mocks.setBadge,
  acceptRemoteAttentionCount: mocks.acceptRemote,
  setSummaryAttentionPublisher: mocks.setPublisher,
  // external mode guard (attention.ts references it)
  isSummaryAttentionExternal: mocks.isExternal,
  setSummaryAttentionExternal: mocks.setExternal,
  clearSummaryAttentionExternal: mocks.clearExternal,
  applyExternalSummaryAttentionBadge: mocks.applyExternal,
  subscribeSummaryAttentionBadge: mocks.subscribeExternal,
}));

import { WKApp } from "@octo/base";
import { createSummaryAttentionRuntime } from "../attentionRuntime";
import { createBrowserAttentionRuntimeHost } from "../browserHost";
import {
  initializeSummaryAttentionRuntime,
  disposeSummaryAttentionRuntime,
  startSummaryAttentionPolling,
  setSummaryAttentionRuntimeVisible,
  teardownBrowserAttentionRuntime,
} from "../attention";
import type { SummaryAttentionRuntimeController, SummaryAttentionRuntimeHost, SummaryAttentionRuntimeScheduler } from "../attentionHost";
import { installExternalSummaryAttention } from "../externalAttention";

type HostEvent = "spaceChanged" | "spaceReady" | "authChanged" | "menuActivated" | "visibilityChanged" | "focused";
function fakeHost() {
  const events = new Map<HostEvent, Set<() => void>>();
  const messages = new Set<(message: unknown) => void>();
  const connections = new Set<() => void>();
  const subscribe = (event: HostEvent) => (handler: () => void) => {
    const handlers = events.get(event) ?? new Set();
    handlers.add(handler);
    events.set(event, handlers);
    return () => { handlers.delete(handler); };
  };
  const host: SummaryAttentionRuntimeHost = {
    isVisible: () => true,
    getScopeId: () => "scope",
    getUserId: () => "user",
    getCurrentSpaceId: () => "space",
    onSpaceChanged: subscribe("spaceChanged"),
    onSpaceReady: subscribe("spaceReady"),
    onAuthStateChanged: subscribe("authChanged"),
    onMenuActivated: subscribe("menuActivated"),
    onVisibilityChanged: subscribe("visibilityChanged"),
    onWindowFocused: subscribe("focused"),
    onImMessage: (handler) => { messages.add(handler); return () => { messages.delete(handler); }; },
    onImConnected: (handler) => { connections.add(handler); return () => { connections.delete(handler); }; },
    invalidateWorkbenchAvailability: vi.fn(),
    emitSummarySpaceChanged: vi.fn(),
  };
  return {
    host,
    emit: (event: HostEvent) => events.get(event)?.forEach((handler) => handler()),
    message: (message: unknown) => messages.forEach((handler) => handler(message)),
    connected: () => connections.forEach((handler) => handler()),
    listenerCount: () => [...events.values()].reduce((sum, handlers) => sum + handlers.size, 0)
      + messages.size + connections.size,
  };
}

const channels: TestBroadcastChannel[] = [];
class TestBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(readonly name: string) { channels.push(this); }
}
const controllers: SummaryAttentionRuntimeController[] = [];
function track(controller: SummaryAttentionRuntimeController) {
  controllers.push(controller);
  return controller;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  // jsdom schedules storage events as timers; count only the runtime's timers.
  vi.spyOn(window, "localStorage", "get").mockReturnValue(memoryStorage());
  mocks.read.mockResolvedValue({ count: 4, sampleAt: 100_000 });
  mocks.events.clear();
  channels.length = 0;
});
afterEach(() => {
  disposeSummaryAttentionRuntime();
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("summary runtime lifecycle", () => {
  it("starts once, registers no page, and cleans up all event sources and timers", () => {
    const f = fakeHost();
    const runtime = track(createSummaryAttentionRuntime(f.host));
    expect(f.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    runtime.init();
    runtime.init();
    expect(f.listenerCount()).toBe(8);
    expect(channels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(2);
    expect(mocks.read).not.toHaveBeenCalled();
    runtime.dispose();
    runtime.dispose();
    expect(f.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(channels[0].close).toHaveBeenCalledOnce();
    f.emit("spaceReady");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("retains Space readiness, invalidation and badge-reset behavior", () => {
    const f = fakeHost();
    track(createSummaryAttentionRuntime(f.host)).init();
    f.emit("spaceChanged");
    expect(mocks.setBadge).not.toHaveBeenCalled();
    expect(f.host.invalidateWorkbenchAvailability).toHaveBeenCalledOnce();
    expect(f.host.emitSummarySpaceChanged).toHaveBeenCalledOnce();
    f.emit("spaceReady");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    f.emit("spaceChanged");
    expect(mocks.setBadge).toHaveBeenCalledExactlyOnceWith(0);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("coalesces relevant IM messages and reconnects through the existing sync window", async () => {
    const f = fakeHost();
    track(createSummaryAttentionRuntime(f.host)).init();
    f.message({ contentType: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.refresh).not.toHaveBeenCalled();
    f.message({ contentType: 21 });
    f.message({ contentType: 2000 });
    f.connected();
    await vi.advanceTimersByTimeAsync(799);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not register optional IM sources when disabled", () => {
    const f = fakeHost();
    track(createSummaryAttentionRuntime(f.host, { observeIm: false })).init();
    expect(f.listenerCount()).toBe(6);
    f.message({ contentType: 21 });
    f.connected();
    vi.advanceTimersByTime(800);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("applies hidden state before scheduling and refreshes after becoming visible", async () => {
    const f = fakeHost();
    const runtime = track(createSummaryAttentionRuntime(f.host, { initialVisible: false, initialPolling: true }));
    runtime.init();
    f.emit("focused");
    f.message({ contentType: 21 });
    f.connected();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    runtime.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("remembers direct pre-init visibility and polling calls", async () => {
    const runtime = track(createSummaryAttentionRuntime(fakeHost().host));
    runtime.setVisible(false);
    runtime.startPolling();
    runtime.init();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
    runtime.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("starts initial polling immediately and only once", async () => {
    const runtime = track(createSummaryAttentionRuntime(fakeHost().host, { initialPolling: true }));
    runtime.init();
    runtime.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("rejects a second owner without letting its disposal clear the active publisher", () => {
    const first = track(createSummaryAttentionRuntime(fakeHost().host));
    const second = track(createSummaryAttentionRuntime(fakeHost().host));
    first.init();
    const publisher = mocks.setPublisher.mock.lastCall?.[0];
    expect(publisher).toBeTypeOf("function");
    expect(() => second.init()).toThrow("another controller is already active");
    second.dispose();
    expect(mocks.setPublisher).toHaveBeenCalledOnce();
    publisher?.(9, 100_000);
    expect(channels[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ count: 9, spaceId: "space" }));
    first.dispose();
    second.init();
    expect(channels).toHaveLength(2);
  });

  it("ignores repeated init even when a host reenters synchronously", () => {
    const f = fakeHost();
    const original = f.host.onSpaceChanged;
    const runtime = track(createSummaryAttentionRuntime(f.host));
    f.host.onSpaceChanged = vi.fn((handler) => {
      runtime.init();
      return original(handler);
    });
    runtime.init();
    expect(f.host.onSpaceChanged).toHaveBeenCalledOnce();
    expect(f.listenerCount()).toBe(8);
  });

  it("rolls back partial registration and retries without losing hidden state", async () => {
    const f = fakeHost();
    const original = f.host.onImConnected;
    f.host.onImConnected = () => { throw new Error("registration failed"); };
    const runtime = track(createSummaryAttentionRuntime(f.host, { initialVisible: false, initialPolling: true }));
    expect(() => runtime.init()).toThrow("registration failed");
    expect(f.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(channels).toHaveLength(0);
    f.host.onImConnected = original;
    runtime.init();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(f.listenerCount()).toBe(8);
  });

  it("keeps configured visibility when a controller is disposed and restarted", async () => {
    const runtime = track(createSummaryAttentionRuntime(fakeHost().host, { initialVisible: false }));
    runtime.init();
    runtime.setVisible(true);
    runtime.dispose();
    mocks.read.mockClear();
    runtime.init();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("does not leak a broadcast channel when the initial host visibility read throws", () => {
    const f = fakeHost();
    let fail = true;
    f.host.isVisible = () => {
      if (fail) throw new Error("visibility unavailable");
      return true;
    };
    const runtime = track(createSummaryAttentionRuntime(f.host));
    expect(() => runtime.init()).toThrow("visibility unavailable");
    expect(f.listenerCount()).toBe(0);
    expect(channels).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    fail = false;
    runtime.init();
    runtime.dispose();
    expect(channels).toHaveLength(1);
    expect(channels[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a partially started leader when scheduler initialization fails", () => {
    let fail = true;
    let nextHandle = 0;
    const scheduled = new Set<number>();
    const schedule = () => { const handle = ++nextHandle; scheduled.add(handle); return handle; };
    const cancel = (handle: unknown) => { if (typeof handle === "number") scheduled.delete(handle); };
    const scheduler: SummaryAttentionRuntimeScheduler = {
      now: Date.now,
      setTimeout: schedule,
      clearTimeout: cancel,
      setInterval: () => {
        if (fail) throw new Error("scheduler unavailable");
        return schedule();
      },
      clearInterval: cancel,
    };
    const f = fakeHost();
    const runtime = track(createSummaryAttentionRuntime(f.host, { scheduler }));
    expect(() => runtime.init()).toThrow("scheduler unavailable");
    expect(f.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(scheduled.size).toBe(0);
    expect(channels[0].close).toHaveBeenCalledOnce();
    expect(mocks.setPublisher).toHaveBeenLastCalledWith(null);
    fail = false;
    runtime.init();
    expect(f.listenerCount()).toBe(8);
    expect(scheduled.size).toBe(2);
  });

  it("cleans up timers even if one host unsubscription throws", () => {
    const f = fakeHost();
    const original = f.host.onSpaceChanged;
    f.host.onSpaceChanged = (handler) => {
      const off = original(handler);
      return () => { off(); throw new Error("cleanup failed"); };
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = track(createSummaryAttentionRuntime(f.host));
    runtime.init();
    runtime.dispose();
    expect(f.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(log).toHaveBeenCalledOnce();
    track(createSummaryAttentionRuntime(fakeHost().host)).init();
    expect(channels).toHaveLength(2);
  });

  it("uses injected scheduling for polling, leader heartbeat and event coalescing", () => {
    let nextId = 0;
    const timeouts = new Map<number, number>();
    const intervals = new Map<number, number>();
    const scheduler: SummaryAttentionRuntimeScheduler = {
      now: () => 100_000,
      setTimeout: (_fn, delay) => { const id = ++nextId; timeouts.set(id, delay); return id; },
      clearTimeout: (id) => { if (typeof id === "number") timeouts.delete(id); },
      setInterval: (_fn, delay) => { const id = ++nextId; intervals.set(id, delay); return id; },
      clearInterval: (id) => { if (typeof id === "number") intervals.delete(id); },
    };
    const f = fakeHost();
    const runtime = track(createSummaryAttentionRuntime(f.host, { scheduler }));
    runtime.init();
    f.message({ contentType: 21 });
    expect([...timeouts.values()].sort((a, b) => a - b)).toEqual([800, 15_000]);
    expect([...intervals.values()]).toEqual([3_000]);
    expect(vi.getTimerCount()).toBe(0);
    runtime.dispose();
    expect(timeouts.size).toBe(0);
    expect(intervals.size).toBe(0);
  });
});

describe("browser host and legacy facade", () => {
  it("exposes browser identity and only forwards Connected SDK status", () => {
    const host = createBrowserAttentionRuntimeHost();
    expect([host.getScopeId(), host.getUserId(), host.getCurrentSpaceId()]).toEqual(["session", "user", "space"]);
    const connected = vi.fn();
    const off = host.onImConnected?.(connected);
    const listener = mocks.addConnectStatusListener.mock.calls[0][0];
    listener(0);
    expect(connected).not.toHaveBeenCalled();
    listener(1);
    expect(connected).toHaveBeenCalledOnce();
    off?.();
    expect(mocks.removeConnectStatusListener).toHaveBeenCalledExactlyOnceWith(listener);
  });

  it("binds and unbinds browser events and still tolerates unavailable IM", () => {
    const host = createBrowserAttentionRuntimeHost();
    const changed = vi.fn();
    const offSpace = host.onSpaceChanged(changed);
    const offFocus = host.onWindowFocused(changed);
    WKApp.mittBus.emit("space-changed");
    window.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenCalledTimes(2);
    offSpace();
    offFocus();
    WKApp.mittBus.emit("space-changed");
    window.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenCalledTimes(2);
    mocks.addMessageListener.mockImplementationOnce(() => { throw new Error("IM unavailable"); });
    expect(() => host.onImMessage?.(vi.fn())()).not.toThrow();
  });

  it("initializes the facade once and cleans up every default event source", () => {
    initializeSummaryAttentionRuntime();
    initializeSummaryAttentionRuntime();
    expect(mocks.addMessageListener).toHaveBeenCalledOnce();
    expect(mocks.addConnectStatusListener).toHaveBeenCalledOnce();
    expect([...mocks.events.values()].every((handlers) => handlers.size === 1)).toBe(true);
    disposeSummaryAttentionRuntime();
    expect([...mocks.events.values()].every((handlers) => handlers.size === 0)).toBe(true);
    expect(mocks.removeMessageListener).toHaveBeenCalledOnce();
    expect(mocks.removeConnectStatusListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors pre-init polling without waiting for the first periodic tick", async () => {
    startSummaryAttentionPolling();
    initializeSummaryAttentionRuntime();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("honors pre-init hidden state without a brief request window", async () => {
    setSummaryAttentionRuntimeVisible(false);
    startSummaryAttentionPolling();
    initializeSummaryAttentionRuntime();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
    setSummaryAttentionRuntimeVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("retries failed facade initialization with pending preferences intact", async () => {
    setSummaryAttentionRuntimeVisible(false);
    startSummaryAttentionPolling();
    vi.spyOn(WKApp.mittBus, "on").mockImplementationOnce(() => { throw new Error("bus unavailable"); });
    expect(() => initializeSummaryAttentionRuntime()).toThrow("bus unavailable");
    expect(vi.getTimerCount()).toBe(0);
    initializeSummaryAttentionRuntime();
    expect(mocks.addMessageListener).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("can retry facade ownership after the previous factory owner stops", () => {
    const owner = track(createSummaryAttentionRuntime(fakeHost().host));
    owner.init();
    expect(() => initializeSummaryAttentionRuntime()).toThrow("another controller is already active");
    owner.dispose();
    initializeSummaryAttentionRuntime();
    expect(mocks.addMessageListener).toHaveBeenCalledOnce();
  });

  it("installExternalSummaryAttention tears down a previously initialized browser runtime", () => {
    // 先初始化浏览器 runtime（leader + poll + timers + channel）
    mocks.read.mockResolvedValue({ count: 4, sampleAt: 100_000 });
    initializeSummaryAttentionRuntime();
    startSummaryAttentionPolling();
    // 确认 runtime 已启动（事件监听、广播通道、至少 leader 心跳定时器）
    // poll 的 tick 暂未调度（等待 leader 首拍 beat 后 onBecomeLeader 才会 start），
    // 但 leader 心跳 interval 就已是一个定时器
    const timerCountBefore = vi.getTimerCount();
    expect(timerCountBefore).toBeGreaterThanOrEqual(1);
    expect(channels).toHaveLength(1);
    // 现在安装外部 controller，它必须拆除浏览器 runtime
    mocks.isExternal.mockReturnValue(false);
    installExternalSummaryAttention({ requestRefresh: vi.fn() });
    // 拆除后不应有残留定时器、广播通道已关闭
    expect(vi.getTimerCount()).toBe(0);
    expect(channels[0].close).toHaveBeenCalledOnce();
    // setExternal 调用过：证明外部控制器完成了安装流程
    expect(mocks.setExternal).toHaveBeenCalledOnce();
  });
});
