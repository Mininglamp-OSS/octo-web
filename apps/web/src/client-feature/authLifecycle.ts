import { runSessionCleanup } from "@octo/base/src/Service/sessionCleanup";

interface AuthExpiryClient {
  logoutCallback?: () => void;
}

interface EphemeralLoginInfo {
  logout(): void | Promise<void>;
}

interface AuthExpiryBridge {
  reportAuthExpired(reason: string): void;
}

export function installFeatureAuthExpiryHandler(
  apiClient: AuthExpiryClient,
  loginInfo: EphemeralLoginInfo,
  bridge: AuthExpiryBridge,
  options: { reason: string; logPrefix: string }
): void {
  let reported = false;
  apiClient.logoutCallback = () => {
    if (reported) return;
    reported = true;
    const cleanup = runSessionCleanup(() => loginInfo.logout(), options.logPrefix);
    const report = () => {
      try {
        bridge.reportAuthExpired(options.reason);
      } catch (error) {
        console.error(`${options.logPrefix} failed to report expired session`, error);
      }
    };
    // Reporting can destroy the renderer; wait for cleanup within its time bound.
    if (cleanup) void cleanup.then(report, () => {
      // Notify the host even when persistence failed, then remove the expired UI.
      report();
      window.location.replace("about:blank");
    });
    else report();
  };
}
