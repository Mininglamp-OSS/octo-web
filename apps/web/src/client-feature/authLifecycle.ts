interface AuthExpiryClient {
  logoutCallback?: () => void;
}

interface EphemeralLoginInfo {
  logout(): void;
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
    loginInfo.logout();
    try {
      bridge.reportAuthExpired(options.reason);
    } catch (error) {
      console.error(
        `${options.logPrefix} failed to report expired session`,
        error
      );
    }
  };
}
