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
    const cleanup = loginInfo.logout();
    const report = () => {
      try {
        bridge.reportAuthExpired(options.reason);
      } catch (error) {
        console.error(`${options.logPrefix} failed to report expired session`, error);
      }
    };
    // Reporting may immediately destroy the renderer. Finish revocation first.
    if (cleanup) void cleanup.then(report, error => {
      console.error(`${options.logPrefix} failed to clean expired session`, error);
      report();
    });
    else report();
  };
}
