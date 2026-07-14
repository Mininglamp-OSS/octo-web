import { ConnectStatus } from "wukongimjssdk";

export interface ImConnectStatusListenerDeps {
  logout: () => void;
  resetTyping: () => void;
  rotateConnectAddress: () => void;
}

export type ImConnectStatusListener = (
  status: ConnectStatus,
  reasonCode?: number
) => void;

export interface ImConnectStatusSdk {
  connectManager: {
    addConnectStatusListener: (listener: ImConnectStatusListener) => void;
  };
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

export function registerImConnectStatusListener(
  sdk: ImConnectStatusSdk,
  deps: ImConnectStatusListenerDeps
) {
  sdk.connectManager.addConnectStatusListener(
    createImConnectStatusListener(deps)
  );
}
