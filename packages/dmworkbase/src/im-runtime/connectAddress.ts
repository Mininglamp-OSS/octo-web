import type { ConnectAddrCallback } from "wukongimjssdk";

export interface ImConnectAddressManagerDeps {
  getConnectAddrs: () => Promise<string[]>;
}

export class ImConnectAddressManager {
  private wsaddrs = new Array<string>();
  private addrUsed = false;

  constructor(private deps: ImConnectAddressManagerDeps) {}

  connectAddrCallback = async (callback: ConnectAddrCallback) => {
    if (!this.wsaddrs || this.wsaddrs.length === 0) {
      this.wsaddrs = await this.deps.getConnectAddrs();
    }
    if (this.wsaddrs.length > 0) {
      this.addrUsed = true;
      callback(this.wsaddrs[0]);
    }
  };

  rotateAfterDisconnect() {
    if (this.addrUsed && this.wsaddrs.length > 1) {
      const oldwsAddr = this.wsaddrs[0];
      this.wsaddrs.splice(0, 1);
      this.wsaddrs.push(oldwsAddr);
      this.addrUsed = false;
    }
  }
}
