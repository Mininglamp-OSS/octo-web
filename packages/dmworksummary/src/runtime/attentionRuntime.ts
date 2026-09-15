/**
 * createSummaryAttentionRuntime -- injectable summary attention runtime.
 *
 * Lifecycle:
 *   const ctrl = createSummaryAttentionRuntime(host, options);
 *   ctrl.init();
 *   ctrl.startPolling();
 *   ctrl.setVisible(visible);
 *   ctrl.dispose();
 *
 * Single-active constraint: only one controller holds the global badge
 * publisher at a time. init() throws Error when another controller is
 * active. On any failure it cleans up (releasing both the publisher and
 * the active-owner slot) before rethrowing so the caller can retry.
 */
import {
  acceptRemoteAttentionCount,
  getSummaryAttentionBadge,
  readSummaryAttentionCount,
  refreshSummaryAttentionBadge,
  setSummaryAttentionBadge,
  setSummaryAttentionPublisher,
} from "../utils/summaryAttentionBadge";
import { createAttentionLeader } from "../utils/summaryAttentionLeader";
import { createAttentionPoll } from "../utils/summaryAttentionPoll";
import {
  createAttentionSync,
  shouldRefreshForMessage,
} from "../utils/summaryAttentionSync";
import type { AttentionLeader } from "../utils/summaryAttentionLeader";
import type { AttentionPoll } from "../utils/summaryAttentionPoll";
import type { AttentionSync } from "../utils/summaryAttentionSync";
import type {
  SummaryAttentionRuntimeHost,
  SummaryAttentionRuntimeController,
  SummaryAttentionRuntimeScheduler,
} from "./attentionHost";

let activeControllerId: symbol | null = null;

export interface CreateSummaryAttentionRuntimeOptions {
  observeIm?: boolean;
  scheduler?: SummaryAttentionRuntimeScheduler;
  initialVisible?: boolean;
  initialPolling?: boolean;
}

function defaultScheduler(): SummaryAttentionRuntimeScheduler {
  return {
    now: Date.now,
    setTimeout: (fn, t) => setTimeout(fn, t),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    setInterval: (fn, t) => setInterval(fn, t),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
}

export function createSummaryAttentionRuntime(
  host: SummaryAttentionRuntimeHost,
  options: CreateSummaryAttentionRuntimeOptions = {}
): SummaryAttentionRuntimeController {
  const observeIm = options.observeIm !== false;
  const sched = options.scheduler ?? defaultScheduler();
  const id = Symbol("controller");

  let initialized = false;
  let pollingStarted = options.initialPolling ?? false;
  let hostVisible = options.initialVisible ?? true;

  let attentionSync: AttentionSync | null = null;
  let attentionPoll: AttentionPoll | null = null;
  let attentionLeader: AttentionLeader | null = null;
  const unsubs: Array<() => void> = [];

  const isRuntimeVisible = () => hostVisible && host.isVisible();
  let initialSpaceReady = false;

  const onSpaceChanged = () => {
    host.invalidateWorkbenchAvailability();
    host.emitSummarySpaceChanged();
    if (!initialSpaceReady) return;
    setSummaryAttentionBadge(0);
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };

  const onSpaceReady = () => {
    initialSpaceReady = true;
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };

  const onAuthStateChanged = () => {
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };

  const onMenuActivated = () => attentionPoll?.notifyActivity();

  const onVisibilityChanged = () => {
    const visible = isRuntimeVisible();
    attentionPoll?.setVisible(visible);
    attentionLeader?.setVisible(visible);
    if (visible) attentionSync?.trigger();
  };

  const onWindowFocused = () => {
    if (!isRuntimeVisible()) return;
    attentionSync?.trigger();
    attentionPoll?.notifyActivity();
  };

  function init(): void {
    if (initialized) return;
    if (activeControllerId !== null && activeControllerId !== id) {
      throw new Error(
        "summary attention runtime: another controller is already active"
      );
    }
    // Claim owner before any side effects. A failure below releases it.
    activeControllerId = id;
    initialized = true;
    const visibleBeforeInit = hostVisible;
    const pollingBeforeInit = pollingStarted;
    try {
      unsubs.push(host.onSpaceChanged(onSpaceChanged));
      unsubs.push(host.onSpaceReady(onSpaceReady));
      unsubs.push(host.onAuthStateChanged(onAuthStateChanged));
      unsubs.push(host.onVisibilityChanged(onVisibilityChanged));
      unsubs.push(host.onWindowFocused(onWindowFocused));
      unsubs.push(host.onMenuActivated(onMenuActivated));

      if (observeIm) {
        const unsubMsg = host.onImMessage?.((message: unknown) => {
          if (!isRuntimeVisible()) return;
          if (shouldRefreshForMessage(message)) attentionSync?.trigger();
        });
        if (unsubMsg) unsubs.push(unsubMsg);

        const unsubConn = host.onImConnected?.(() => {
          if (!isRuntimeVisible()) return;
          attentionSync?.trigger();
        });
        if (unsubConn) unsubs.push(unsubConn);
      }

      attentionSync = createAttentionSync({
        refresh: refreshSummaryAttentionBadge,
        now: sched.now,
        setTimeoutFn: sched.setTimeout,
        clearTimeoutFn: sched.clearTimeout,
      });

      attentionPoll = createAttentionPoll({
        fetchCount: async () => {
          const sample = await readSummaryAttentionCount();
          return sample?.count ?? getSummaryAttentionBadge();
        },
        isVisible: isRuntimeVisible,
        now: sched.now,
        setTimeoutFn: sched.setTimeout,
        clearTimeoutFn: sched.clearTimeout,
      });

      attentionLeader = createAttentionLeader({
        scopeId: host.getScopeId(),
        getUserId: () => host.getUserId(),
        onBecomeLeader: () => {
          attentionPoll?.start();
          if (pollingStarted) attentionPoll?.notifyActivity();
        },
        onResignLeader: () => attentionPoll?.stop(),
        isVisible: isRuntimeVisible,
        onRemoteCount: (count, spaceId, sampleAt) => {
          if (!spaceId || spaceId !== host.getCurrentSpaceId()) return;
          acceptRemoteAttentionCount(count, sampleAt);
        },
        now: sched.now,
        setIntervalFn: sched.setInterval,
        clearIntervalFn: sched.clearInterval,
      });

      setSummaryAttentionPublisher((count, sampleAt) => {
        attentionLeader?.publish(
          count,
          host.getCurrentSpaceId(),
          sampleAt,
        );
      });

      attentionLeader.start();
    } catch (err) {
      dispose();
      hostVisible = visibleBeforeInit;
      pollingStarted = pollingBeforeInit;
      throw err;
    }
  }

  function startPolling(): void {
    if (pollingStarted) return;
    pollingStarted = true;
    if (isRuntimeVisible()) attentionPoll?.notifyActivity();
  }

  function setVisible(visible: boolean): void {
    hostVisible = visible;
    const effectiveVisible = isRuntimeVisible();
    attentionPoll?.setVisible(effectiveVisible);
    attentionLeader?.setVisible(effectiveVisible);
    if (effectiveVisible) {
      attentionSync?.trigger();
      if (pollingStarted) attentionPoll?.notifyActivity();
    }
  }

  function disposeInternal(): void {
    const cleanups = [
      ...unsubs.splice(0).reverse(),
      () => attentionSync?.cancel(),
      () => attentionLeader?.stop(),
      () => attentionPoll?.stop(),
    ];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        console.error("[summary-runtime] cleanup failed", error);
      }
    }
    attentionSync = null;
    attentionLeader = null;
    attentionPoll = null;
    pollingStarted = options.initialPolling ?? false;
    hostVisible = options.initialVisible ?? true;
    initialSpaceReady = false;
    initialized = false;
  }

  function dispose(): void {
    if (activeControllerId === id) {
      setSummaryAttentionPublisher(null);
    }
    disposeInternal();
    if (activeControllerId === id) activeControllerId = null;
  }

  return { init, startPolling, setVisible, dispose };
}
