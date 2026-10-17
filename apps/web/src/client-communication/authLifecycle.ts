import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { installFeatureAuthExpiryHandler } from "../client-feature/authLifecycle";

interface AuthExpiryClient {
  logoutCallback?: () => void;
}

interface EphemeralLoginInfo {
  logout(): void | Promise<void>;
}

export function installCommunicationAuthExpiryHandler(
  apiClient: AuthExpiryClient,
  loginInfo: EphemeralLoginInfo,
  bridge: OctoBuddyCommunicationBridge
): void {
  installFeatureAuthExpiryHandler(apiClient, loginInfo, bridge, {
    reason: "Communication session expired",
    logPrefix: "[client-communication]",
  });
}
