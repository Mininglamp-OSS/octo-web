import { ConnectStatus } from "wukongimjssdk";

export interface ImConnectStatusListenerDeps {
  logout: () => void;
  resetTyping: () => void;
  rotateConnectAddress: () => void;
}

export function createImConnectStatusListener(
  deps: ImConnectStatusListenerDeps
) {
  return (status: ConnectStatus, reasonCode?: number) => {
    if (status === ConnectStatus.ConnectKick) {
      deps.logout();
    } else if (reasonCode === 2) {
      deps.logout();
    } else if (status === ConnectStatus.Connected) {
      deps.resetTyping();
    } else if (status === ConnectStatus.Disconnect) {
      deps.rotateConnectAddress();
    }
  };
}
