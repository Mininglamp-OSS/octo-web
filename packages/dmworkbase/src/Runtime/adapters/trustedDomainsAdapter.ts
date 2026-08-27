import type { RuntimeEnvironment } from "../runtimeEnvironment";
import {
  IPC_TRUSTED_DOMAINS_GET,
  IPC_TRUSTED_DOMAIN_REMOVE,
} from "../../../../../apps/web/src-election/shared/ipc-channels";

type SettingsWindow = Window & {
  ipc?: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
};

export interface TrustedDomainsAdapter {
  get(): Promise<string[]>;
  remove(host: string): Promise<string[]>;
}

class ElectronTrustedDomainsAdapter implements TrustedDomainsAdapter {
  private readonly ipc = (window as SettingsWindow).ipc!;

  async get(): Promise<string[]> {
    return await this.ipc.invoke(IPC_TRUSTED_DOMAINS_GET) as string[];
  }

  async remove(host: string): Promise<string[]> {
    return await this.ipc.invoke(IPC_TRUSTED_DOMAIN_REMOVE, host) as string[];
  }
}

export function createTrustedDomainsAdapter(
  environment: RuntimeEnvironment,
): TrustedDomainsAdapter | null {
  return environment.target === "desktop"
    && environment.shell === "electron"
    && typeof window !== "undefined"
    && Boolean((window as SettingsWindow).ipc)
    ? new ElectronTrustedDomainsAdapter()
    : null;
}
