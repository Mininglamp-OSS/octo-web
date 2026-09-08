import { getSessionSid, WKApp } from "@octo/base";
import WKSDK, { ConnectStatus } from "wukongimjssdk";
import { summaryWorkbenchAvailability } from "../features/summaryWorkbench/availability";
import {
  acceptRemoteAttentionCount,
  getSummaryAttentionBadge,
  readSummaryAttentionCount,
  refreshSummaryAttentionBadge,
  setSummaryAttentionBadge,
  setSummaryAttentionPublisher,
} from "../utils/summaryAttentionBadge";
import {
  createAttentionLeader,
  type AttentionLeader,
} from "../utils/summaryAttentionLeader";
import {
  createAttentionPoll,
  type AttentionPoll,
} from "../utils/summaryAttentionPoll";
import {
  createAttentionSync,
  shouldRefreshForMessage,
  type AttentionSync,
} from "../utils/summaryAttentionSync";

let runtimeInitialized = false;
let spaceChangedHandler: (() => void) | null = null;
let spaceReadyHandler: (() => void) | null = null;
let authStateChangedHandler: (() => void) | null = null;
let attentionSync: AttentionSync | null = null;
let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let attentionPoll: AttentionPoll | null = null;
let attentionLeader: AttentionLeader | null = null;
let attentionStarted = false;
let menuActivatedHandler: (() => void) | null = null;
let imMessageHandler: ((message: unknown) => void) | null = null;
let imConnectHandler: ((status: unknown) => void) | null = null;
let hostVisible = true;

const isDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";
const isRuntimeVisible = () => hostVisible && isDocumentVisible();

export function initializeSummaryAttentionRuntime(
  options: { observeIm?: boolean } = {}
): void {
  if (runtimeInitialized) return;
  runtimeInitialized = true;

  let initialSpaceReady = false;
  spaceChangedHandler = () => {
    summaryWorkbenchAvailability.invalidate();
    WKApp.mittBus.emit("summary-space-changed");
    if (!initialSpaceReady) return;
    setSummaryAttentionBadge(0);
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };
  spaceReadyHandler = () => {
    initialSpaceReady = true;
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };
  authStateChangedHandler = () => {
    attentionPoll?.notifyActivity();
    refreshSummaryAttentionBadge();
  };
  WKApp.mittBus.on("space-changed", spaceChangedHandler);
  WKApp.mittBus.on("space-ready", spaceReadyHandler);
  WKApp.mittBus.on("wk:auth-state-changed", authStateChangedHandler);

  attentionSync = createAttentionSync({
    refresh: refreshSummaryAttentionBadge,
  });
  attentionPoll = createAttentionPoll({
    fetchCount: async () => {
      const sample = await readSummaryAttentionCount();
      return sample?.count ?? getSummaryAttentionBadge();
    },
    isVisible: isRuntimeVisible,
  });

  attentionLeader = createAttentionLeader({
    scopeId: getSessionSid(),
    getUserId: () => WKApp.loginInfo.uid ?? "",
    onBecomeLeader: () => {
      attentionPoll?.start();
      if (attentionStarted) attentionPoll?.notifyActivity();
    },
    onResignLeader: () => attentionPoll?.stop(),
    isVisible: isRuntimeVisible,
    onRemoteCount: (count, spaceId, sampleAt) => {
      if (!spaceId || spaceId !== WKApp.shared.currentSpaceId) return;
      acceptRemoteAttentionCount(count, sampleAt);
    },
  });
  setSummaryAttentionPublisher((count, sampleAt) => {
    attentionLeader?.publish(
      count,
      WKApp.shared.currentSpaceId ?? "",
      sampleAt
    );
  });
  attentionLeader.start();

  visibilityHandler = () => {
    const visible = isRuntimeVisible();
    attentionPoll?.setVisible(visible);
    attentionLeader?.setVisible(visible);
    if (visible) attentionSync?.trigger();
  };
  focusHandler = () => {
    if (!isRuntimeVisible()) return;
    attentionSync?.trigger();
    attentionPoll?.notifyActivity();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", visibilityHandler);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", focusHandler);
  }

  menuActivatedHandler = () => attentionPoll?.notifyActivity();
  WKApp.mittBus.on("wk:active-menu-changed", menuActivatedHandler);

  if (options.observeIm !== false) {
    try {
      const sdk = WKSDK.shared();
      imMessageHandler = (message: unknown) => {
        if (!isRuntimeVisible()) return;
        if (shouldRefreshForMessage(message)) attentionSync?.trigger();
      };
      sdk.chatManager.addMessageListener(imMessageHandler as any);
      imConnectHandler = (status: unknown) => {
        if (!isRuntimeVisible()) return;
        if (status === ConnectStatus.Connected) attentionSync?.trigger();
      };
      sdk.connectManager.addConnectStatusListener(imConnectHandler as any);
    } catch {
      // Attention refresh remains available through focus and visibility events.
    }
  }
}

export function startSummaryAttentionPolling(): void {
  if (attentionStarted) return;
  attentionStarted = true;
  if (isRuntimeVisible()) attentionPoll?.notifyActivity();
}

export function setSummaryAttentionRuntimeVisible(visible: boolean): void {
  hostVisible = visible;
  const effectiveVisible = isRuntimeVisible();
  attentionPoll?.setVisible(effectiveVisible);
  attentionLeader?.setVisible(effectiveVisible);
  if (effectiveVisible) {
    attentionSync?.trigger();
    if (attentionStarted) attentionPoll?.notifyActivity();
  }
}

export function disposeSummaryAttentionRuntime(): void {
  if (spaceChangedHandler) {
    WKApp.mittBus.off("space-changed", spaceChangedHandler);
    spaceChangedHandler = null;
  }
  if (spaceReadyHandler) {
    WKApp.mittBus.off("space-ready", spaceReadyHandler);
    spaceReadyHandler = null;
  }
  if (authStateChangedHandler) {
    WKApp.mittBus.off("wk:auth-state-changed", authStateChangedHandler);
    authStateChangedHandler = null;
  }
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }
  visibilityHandler = null;
  if (focusHandler && typeof window !== "undefined") {
    window.removeEventListener("focus", focusHandler);
  }
  focusHandler = null;

  try {
    const sdk = WKSDK.shared();
    if (imMessageHandler)
      sdk.chatManager.removeMessageListener(imMessageHandler as any);
    if (imConnectHandler)
      sdk.connectManager.removeConnectStatusListener(imConnectHandler as any);
  } catch {
    // Registration also tolerates an unavailable SDK.
  }
  imMessageHandler = null;
  imConnectHandler = null;

  attentionSync?.cancel();
  attentionSync = null;
  setSummaryAttentionPublisher(null);
  attentionLeader?.stop();
  attentionLeader = null;
  attentionPoll?.stop();
  attentionPoll = null;
  attentionStarted = false;
  hostVisible = true;

  if (menuActivatedHandler) {
    WKApp.mittBus.off("wk:active-menu-changed", menuActivatedHandler);
    menuActivatedHandler = null;
  }
  runtimeInitialized = false;
}
