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

export interface ImConnectStatusRuntimeSdk {
  connectManager: {
    status: ConnectStatus;
    addConnectStatusListener: (listener: ImConnectStatusListener) => void;
    removeConnectStatusListener: (listener: ImConnectStatusListener) => void;
    connect: () => void;
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

export function getImConnectStatus(sdk: ImConnectStatusRuntimeSdk) {
  return sdk.connectManager.status;
}

export function isImConnected(sdk: ImConnectStatusRuntimeSdk) {
  return getImConnectStatus(sdk) === ConnectStatus.Connected;
}

export function addImConnectStatusListener(
  sdk: ImConnectStatusRuntimeSdk,
  listener: ImConnectStatusListener
) {
  sdk.connectManager.addConnectStatusListener(listener);
}

export function removeImConnectStatusListener(
  sdk: ImConnectStatusRuntimeSdk,
  listener: ImConnectStatusListener
) {
  sdk.connectManager.removeConnectStatusListener(listener);
}

export function reconnectImWhenNotConnected(
  sdk: ImConnectStatusRuntimeSdk,
  status: ConnectStatus
) {
  if (status !== ConnectStatus.Connected) {
    sdk.connectManager.connect();
  }
}
