import type { RuntimeEnvironment } from "../runtimeEnvironment";
import { IPC_KEEP_AWAKE_GET, IPC_KEEP_AWAKE_SET } from "../../../../../apps/web/src-election/shared/ipc-channels";

export interface KeepAwakeAdapter {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
}

type KeepAwakeWindow = Window & {
  ipc?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
};

class ElectronKeepAwakeAdapter implements KeepAwakeAdapter {
  private readonly ipc = (window as KeepAwakeWindow).ipc!;

  async getEnabled(): Promise<boolean> {
    return (await this.ipc.invoke(IPC_KEEP_AWAKE_GET)) === true;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    return (await this.ipc.invoke(IPC_KEEP_AWAKE_SET, enabled)) === true;
  }
}

export function createKeepAwakeAdapter(environment: RuntimeEnvironment): KeepAwakeAdapter | null {
  return environment.capabilities.has("keepAwake") ? new ElectronKeepAwakeAdapter() : null;
}
