import type { IModule } from "@octo/base";
import { startSummaryAttentionPolling } from "./runtime/attention";
import {
  disposeSummaryWebRuntime,
  initializeSummaryWebRuntime,
} from "./runtime/lifecycle";
import "./index.css";

export class SummaryModule implements IModule {
  id(): string {
    return "SummaryModule";
  }

  init(): void {
    initializeSummaryWebRuntime();
  }
}

export function disposeSummaryModuleListeners(): void {
  disposeSummaryWebRuntime();
}

export { startSummaryAttentionPolling };

if (import.meta.hot) {
  import.meta.hot.dispose(disposeSummaryModuleListeners);
}
