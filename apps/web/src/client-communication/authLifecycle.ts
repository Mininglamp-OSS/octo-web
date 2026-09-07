import type { OctoBuddyCommunicationBridge } from "./hostBridge";

interface AuthExpiryClient {
  logoutCallback?: () => void;
}

interface EphemeralLoginInfo {
  logout(): void;
}

export function installCommunicationAuthExpiryHandler(
  apiClient: AuthExpiryClient,
  loginInfo: EphemeralLoginInfo,
  bridge: OctoBuddyCommunicationBridge
): void {
  let reported = false;
  apiClient.logoutCallback = () => {
    if (reported) return;
    reported = true;
    loginInfo.logout();
    try {
      bridge.reportAuthExpired("Communication session expired");
    } catch (error) {
      console.error(
        "[client-communication] failed to report expired session",
        error
      );
    }
  };
}
