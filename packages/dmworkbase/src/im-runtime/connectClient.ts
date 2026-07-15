export interface ImConnectClientLoginInfo {
  uid: string;
  token: string;
}

export interface ImConnectClientSdk {
  config: {
    uid: string;
    token: string;
  };
  connect: () => void;
}

export interface ConnectImClientDeps {
  sdk: ImConnectClientSdk;
  loginInfo: ImConnectClientLoginInfo;
}

export function connectImClient(deps: ConnectImClientDeps) {
  deps.sdk.config.uid = deps.loginInfo.uid;
  deps.sdk.config.token = deps.loginInfo.token;
  deps.sdk.connect();
}
