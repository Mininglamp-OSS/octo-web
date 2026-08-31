export type AppTarget = "web" | "desktop";
export type DesktopShell = "electron" | "tauri" | "unknown";
export type OperatingSystem = "windows" | "macos" | "linux" | "ios" | "android" | "unknown";

export type RuntimeCapability =
  | "nativeNotifications"
  | "browserNotifications"
  | "fileSystem"
  | "downloadDirectory"
  | "autoUpdate"
  | "voiceInput"
  | "keepAwake";

export interface RuntimeEnvironment {
  target: AppTarget;
  shell: DesktopShell | null;
  os: OperatingSystem;
  capabilities: ReadonlySet<RuntimeCapability>;
}

interface RuntimeWindow extends Window {
  __POWERED_ELECTRON__?: boolean;
  __TAURI_IPC__?: unknown;
  __TAURI_OS__?: string;
  electronNotification?: unknown;
  ipc?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
}

function detectOperatingSystem(platform: string): OperatingSystem {
  if (/android/i.test(platform)) return "android";
  if (/iphone|ipad|ios/i.test(platform)) return "ios";
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  if (/linux/i.test(platform)) return "linux";
  return "unknown";
}

export function detectRuntimeEnvironment(isDesktopHint = false): RuntimeEnvironment {
  if (typeof window === "undefined") {
    return { target: isDesktopHint ? "desktop" : "web", shell: null, os: "unknown", capabilities: new Set() };
  }

  const runtimeWindow = window as RuntimeWindow;
  const hasTauri = Boolean(runtimeWindow.__TAURI_IPC__);
  // Electron 的 preload 标记在部分开发刷新场景下可能未及时注入，User-Agent
  // 仍然是宿主提供的稳定信号；两者都属于运行时环境检测，不向业务层泄漏判断细节。
  const hasElectron = Boolean(runtimeWindow.__POWERED_ELECTRON__) || /Electron\//i.test(navigator.userAgent);
  const isFileProtocol = window.location.protocol === "file:";
  const target: AppTarget = hasTauri || hasElectron || isFileProtocol || isDesktopHint ? "desktop" : "web";
  const shell: DesktopShell | null = hasTauri ? "tauri" : hasElectron ? "electron" : target === "desktop" ? "unknown" : null;
  const platform = runtimeWindow.__TAURI_OS__ || navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const os = detectOperatingSystem(platform);
  const capabilities = new Set<RuntimeCapability>(["voiceInput"]);

  if (typeof Notification !== "undefined") capabilities.add("browserNotifications");
  if (runtimeWindow.electronNotification) capabilities.add("nativeNotifications");
  if (target === "desktop") {
    capabilities.add("fileSystem");
    capabilities.add("downloadDirectory");
    capabilities.add("autoUpdate");
    if (shell === "electron" && runtimeWindow.ipc) capabilities.add("keepAwake");
  }

  return { target, shell, os, capabilities };
}
