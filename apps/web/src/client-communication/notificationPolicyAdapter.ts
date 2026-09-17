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

  // Pause pushes are independently supported by the legacy quick-mute store.
  const cleanupProvider = host.getNotificationPreferences
    ? installNotificationProvider({ getPreferences: host.getNotificationPreferences.bind(host) })
    : undefined;

  let disposed = false;
  const unsubscribePause = host.onNotificationPauseChanged?.((value) => {
    if (disposed) return;
    // The store owns validation, revision ordering and any reconciliation fetch.
    quickMuteStore.applyRemoteCMD(value);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    cleanupProvider?.();
    unsubscribePause?.();
  };
}
