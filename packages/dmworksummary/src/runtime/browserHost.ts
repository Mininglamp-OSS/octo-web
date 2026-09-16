import { getSessionSid, WKApp } from "@octo/base";
import WKSDK, { ConnectStatus, type Message } from "wukongimjssdk";
import { summaryWorkbenchAvailability } from "../features/summaryWorkbench/availability";
import type { SummaryAttentionRuntimeHost } from "./attentionHost";

export function createBrowserAttentionRuntimeHost(): SummaryAttentionRuntimeHost {
  const browserDocument = typeof document !== "undefined" ? document : null;
  const browserWindow = typeof window !== "undefined" ? window : null;

  return {
    isVisible() {
      return !browserDocument || browserDocument.visibilityState === "visible";
    },
    getScopeId() { return getSessionSid(); },
    getUserId() { return WKApp.loginInfo.uid ?? ""; },
    getCurrentSpaceId() { return WKApp.shared.currentSpaceId ?? ""; },

    onSpaceChanged(handler: () => void) {
      WKApp.mittBus.on("space-changed", handler);
      return () => { WKApp.mittBus.off("space-changed", handler); };
    },
    onSpaceReady(handler: () => void) {
      WKApp.mittBus.on("space-ready", handler);
      return () => { WKApp.mittBus.off("space-ready", handler); };
    },
    onAuthStateChanged(handler: () => void) {
      WKApp.mittBus.on("wk:auth-state-changed", handler);
      return () => { WKApp.mittBus.off("wk:auth-state-changed", handler); };
    },
    onMenuActivated(handler: () => void) {
      WKApp.mittBus.on("wk:active-menu-changed", handler);
      return () => { WKApp.mittBus.off("wk:active-menu-changed", handler); };
    },
    onVisibilityChanged(handler: () => void) {
      if (!browserDocument) return () => {};
      browserDocument.addEventListener("visibilitychange", handler);
      return () => browserDocument.removeEventListener("visibilitychange", handler);
    },
    onWindowFocused(handler: () => void) {
      if (!browserWindow) return () => {};
      browserWindow.addEventListener("focus", handler);
      return () => browserWindow.removeEventListener("focus", handler);
    },

    onImMessage(handler: (message: unknown) => void) {
      try {
        const sdk = WKSDK.shared();
        const listener = (message: Message) => { handler(message); };
        sdk.chatManager.addMessageListener(listener);
        return () => { sdk.chatManager.removeMessageListener(listener); };
      } catch {
        // Legacy hosts may not expose IM; focus and visibility still refresh.
        return () => {};
      }
    },
    onImConnected(handler: () => void) {
      try {
        const sdk = WKSDK.shared();
        const listener = (status: ConnectStatus) => {
          if (status === ConnectStatus.Connected) handler();
        };
        sdk.connectManager.addConnectStatusListener(listener);
        return () => { sdk.connectManager.removeConnectStatusListener(listener); };
      } catch { return () => {}; }
    },

    invalidateWorkbenchAvailability() { summaryWorkbenchAvailability.invalidate(); },
    emitSummarySpaceChanged() { WKApp.mittBus.emit("summary-space-changed"); },
  };
}
