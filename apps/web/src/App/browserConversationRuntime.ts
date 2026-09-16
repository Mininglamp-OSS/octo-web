import { getCurrentImConversationStore, WKApp } from "@octo/base";

/** The full Web entry shares Chat's data owner without mounting a chat surface. */
export function startBrowserConversationRuntime(): () => void {
  let release: (() => void) | undefined;
  let stopped = false;
  let acquiring = false;
  const reconcile = () => {
    if (stopped || acquiring) return;
    if (WKApp.loginInfo.isLogined()) {
      if (release) return;
      acquiring = true;
      try {
        const acquired = getCurrentImConversationStore().retain();
        // Startup can publish synchronous events before returning its cleanup.
        if (stopped || !WKApp.loginInfo.isLogined()) acquired();
        else release = acquired;
      } finally {
        acquiring = false;
      }
    } else {
      const dispose = release;
      release = undefined;
      dispose?.();
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    WKApp.mittBus.off("wk:auth-state-changed", reconcile);
    const dispose = release;
    release = undefined;
    dispose?.();
  };
  WKApp.mittBus.on("wk:auth-state-changed", reconcile);
  try {
    reconcile();
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
