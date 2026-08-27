import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearElectronAuthSession,
  getElectronIpcBridge,
  getElectronMediaAccessStatus,
  getElectronNotificationBridge,
  getElectronWindowBridge,
  getOctoElectronBridge,
  isElectronPowered,
  isElectronShellBridgeAvailable,
  restartElectronApp,
  sendElectronCancelUpdateDownload,
  sendElectronCheckUpdate,
  sendElectronConversationUnreadCount,
  sendElectronUpdateApp,
  startElectronScreenshot,
} from "../desktopBridge";

describe("desktopBridge", () => {
  afterEach(() => {
    delete window.__POWERED_ELECTRON__;
    delete window.ipc;
    delete window.octoElectron;
    delete window.electronNotification;
  });

  it("prefers the typed octoElectron bridge over legacy ipc/notification globals", () => {
    const typedIpc = { send: vi.fn(), invoke: vi.fn(), on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };
    const legacyIpc = { send: vi.fn(), invoke: vi.fn(), on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };
    const typedNotification = {
      show: vi.fn(),
      close: vi.fn(),
      closeAll: vi.fn(),
      onClicked: vi.fn(),
      onActionClicked: vi.fn(),
      testNotificationIcon: vi.fn(),
    };
    const legacyNotification = { ...typedNotification, show: vi.fn() };
    window.octoElectron = {
      ipc: typedIpc,
      oidc: {
        authorizeStart: vi.fn(),
        authorizeEnd: vi.fn(),
        httpRequest: vi.fn(),
        openExternal: vi.fn(),
        clearAuthSession: vi.fn(),
      },
      notification: typedNotification,
      window: { isFocused: vi.fn() },
      conversation: { setUnreadCount: vi.fn() },
      system: {
        startScreenshot: vi.fn(),
        getMediaAccessStatus: vi.fn(),
        restartApp: vi.fn(),
      },
    };
    window.ipc = legacyIpc;
    window.electronNotification = legacyNotification;

    expect(getOctoElectronBridge()).toBe(window.octoElectron);
    expect(getElectronIpcBridge()).toBe(typedIpc);
    expect(getElectronNotificationBridge()).toBe(typedNotification);
    expect(getElectronWindowBridge()).toBe(window.octoElectron.window);
  });

  it("falls back to legacy ipc for update, unread-count, and system IPC", async () => {
    const send = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ status: "granted" });
    window.ipc = { send, invoke, on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };

    sendElectronConversationUnreadCount(7);
    sendElectronCheckUpdate();
    sendElectronUpdateApp();
    sendElectronCancelUpdateDownload();
    startElectronScreenshot({ silent: true });
    await expect(getElectronMediaAccessStatus("camera")).resolves.toEqual({ status: "granted" });
    restartElectronApp();

    expect(send).toHaveBeenNthCalledWith(1, "conversation-manager-unread-count", 7);
    expect(send).toHaveBeenNthCalledWith(2, "check-update");
    expect(send).toHaveBeenNthCalledWith(3, "update-app");
    expect(send).toHaveBeenNthCalledWith(4, "cancel-update-download");
    expect(send).toHaveBeenNthCalledWith(5, "screenshots-start", { silent: true });
    expect(send).toHaveBeenNthCalledWith(6, "restart-app");
    expect(invoke).toHaveBeenCalledWith("get-media-access-status", "camera");
  });

  it("uses typed conversation and system bridge methods when available", async () => {
    const setUnreadCount = vi.fn();
    const startScreenshot = vi.fn();
    const getMediaAccessStatus = vi.fn().mockResolvedValue({ status: "prompt" });
    const restartApp = vi.fn();
    const clearAuthSession = vi.fn().mockResolvedValue({ ok: true });
    window.octoElectron = {
      ipc: { send: vi.fn(), invoke: vi.fn(), on: vi.fn(), once: vi.fn(), removeListener: vi.fn() },
      oidc: {
        authorizeStart: vi.fn(),
        authorizeEnd: vi.fn(),
        httpRequest: vi.fn(),
        openExternal: vi.fn(),
        clearAuthSession,
      },
      notification: {
        show: vi.fn(),
        close: vi.fn(),
        closeAll: vi.fn(),
        onClicked: vi.fn(),
        onActionClicked: vi.fn(),
        testNotificationIcon: vi.fn(),
      },
      window: { isFocused: vi.fn() },
      conversation: { setUnreadCount },
      system: { startScreenshot, getMediaAccessStatus, restartApp },
    };

    sendElectronConversationUnreadCount(3);
    startElectronScreenshot();
    await expect(getElectronMediaAccessStatus("microphone")).resolves.toEqual({ status: "prompt" });
    restartElectronApp();
    await expect(clearElectronAuthSession()).resolves.toEqual({ ok: true });

    expect(setUnreadCount).toHaveBeenCalledWith(3);
    expect(startScreenshot).toHaveBeenCalledWith(undefined);
    expect(getMediaAccessStatus).toHaveBeenCalledWith("microphone");
    expect(restartApp).toHaveBeenCalledOnce();
    expect(clearAuthSession).toHaveBeenCalledOnce();
  });

  it("adapts the legacy notification focus API as a window bridge", async () => {
    const isWindowFocused = vi.fn().mockResolvedValue(false);
    window.electronNotification = {
      show: vi.fn(),
      close: vi.fn(),
      closeAll: vi.fn(),
      onClicked: vi.fn(),
      onActionClicked: vi.fn(),
      testNotificationIcon: vi.fn(),
      isWindowFocused,
    };

    await expect(getElectronWindowBridge()?.isFocused()).resolves.toBe(false);
    expect(isWindowFocused).toHaveBeenCalledOnce();
  });

  it("reports shell availability only when Electron marker and a bridge both exist", () => {
    expect(isElectronPowered()).toBe(false);
    expect(isElectronShellBridgeAvailable()).toBe(false);

    window.__POWERED_ELECTRON__ = true;
    expect(isElectronPowered()).toBe(true);
    expect(isElectronShellBridgeAvailable()).toBe(false);

    window.ipc = { send: vi.fn(), invoke: vi.fn(), on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };
    expect(isElectronShellBridgeAvailable()).toBe(true);
  });

  it("falls back to legacy IPC for auth-session cleanup", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, partial: false });
    window.ipc = { send: vi.fn(), invoke, on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };

    await expect(clearElectronAuthSession()).resolves.toEqual({ ok: true, partial: false });
    expect(invoke).toHaveBeenCalledWith("octo:oidc:clear-auth-session");
  });
});
