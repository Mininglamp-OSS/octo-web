import type { RuntimeEnvironment } from "../runtimeEnvironment";
import { IPC_DESKTOP_SETTINGS_GET, IPC_DESKTOP_SETTINGS_SET } from "../../../../../apps/web/src-election/shared/ipc-channels";

export type DesktopSettings = {
  zoomFactor: number;
  launchAtLogin: boolean;
  showOnTray: boolean;
  closeBehavior: "background" | "quit";
};

export interface DesktopSettingsAdapter {
  get(): Promise<DesktopSettings>;
  set(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
}

type SettingsWindow = Window & { ipc?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };

class ElectronDesktopSettingsAdapter implements DesktopSettingsAdapter {
  private readonly ipc = (window as SettingsWindow).ipc!;

  async get(): Promise<DesktopSettings> {
    return await this.ipc.invoke(IPC_DESKTOP_SETTINGS_GET) as DesktopSettings;
  }

  async set(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
    return await this.ipc.invoke(IPC_DESKTOP_SETTINGS_SET, patch) as DesktopSettings;
  }
}

export function createDesktopSettingsAdapter(environment: RuntimeEnvironment): DesktopSettingsAdapter | null {
  return environment.target === "desktop" && environment.shell === "electron" && typeof window !== "undefined" && Boolean((window as SettingsWindow).ipc)
    ? new ElectronDesktopSettingsAdapter()
    : null;
}
