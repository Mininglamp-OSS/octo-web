import type { RuntimeEnvironment } from "../runtimeEnvironment";
import { IPC_DOWNLOAD_DIRECTORY_CHOOSE, IPC_DOWNLOAD_SETTINGS_GET, IPC_DOWNLOAD_SETTINGS_SET } from "../../../../../apps/web/src-election/shared/ipc-channels";

export type DownloadSettings = { directory: string; askBeforeSaving: boolean };
export interface DownloadSettingsAdapter {
  get(): Promise<DownloadSettings>;
  set(patch: Pick<DownloadSettings, "askBeforeSaving">): Promise<DownloadSettings>;
  chooseDirectory(): Promise<DownloadSettings>;
}

type SettingsWindow = Window & { ipc?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
class ElectronDownloadSettingsAdapter implements DownloadSettingsAdapter {
  private readonly ipc = (window as SettingsWindow).ipc!;
  get() { return this.ipc.invoke(IPC_DOWNLOAD_SETTINGS_GET) as Promise<DownloadSettings>; }
  set(patch: Pick<DownloadSettings, "askBeforeSaving">) { return this.ipc.invoke(IPC_DOWNLOAD_SETTINGS_SET, patch) as Promise<DownloadSettings>; }
  chooseDirectory() { return this.ipc.invoke(IPC_DOWNLOAD_DIRECTORY_CHOOSE) as Promise<DownloadSettings>; }
}

export function createDownloadSettingsAdapter(environment: RuntimeEnvironment): DownloadSettingsAdapter | null {
  return environment.target === "desktop" && environment.shell === "electron" && typeof window !== "undefined" && Boolean((window as SettingsWindow).ipc)
    ? new ElectronDownloadSettingsAdapter() : null;
}
