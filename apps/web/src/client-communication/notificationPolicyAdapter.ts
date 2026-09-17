import { quickMuteStore } from "@octo/base/src/Components/NavRail/QuickMuteStore";
import { installNotificationProvider } from "@octo/base/src/features/notifications";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

/**
 * Adapter that links the communication renderer to the Client's mute-scope
 * preferences. Installed after the login session is bound.
 *
 * Disposal preserves a closed host context, including for pending consumers.
 */
export function installHostNotificationPolicyAdapter(
  host: OctoBuddyCommunicationBridge,
): () => void {
  if (!host.getNotificationPreferences && !host.onNotificationPauseChanged) {
    return () => {};
  }

  const cleanupProvider = installNotificationProvider({
    getPreferences: async () => {
      if (!host.getNotificationPreferences) {
        throw new Error("Host notification preferences unavailable");
      }
      return host.getNotificationPreferences();
    },
  });

  let disposed = false;
  const unsubscribePause = host.onNotificationPauseChanged?.((value) => {
    if (disposed) return;
    if (quickMuteStore.applyRemoteCMD(value)) return;
    void quickMuteStore.refresh().catch(() => undefined);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    cleanupProvider();
    unsubscribePause?.();
  };
}
