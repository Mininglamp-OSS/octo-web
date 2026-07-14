import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImConnectAddressManager } from "./connectAddress";

function createDeps(addrs: string[]) {
  return {
    getConnectAddrs: vi.fn().mockResolvedValue(addrs),
  };
}

describe("ImConnectAddressManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads connect addresses and returns the first address", async () => {
    const deps = createDeps(["ws://a", "ws://b"]);
    const manager = new ImConnectAddressManager(deps);
    const callback = vi.fn();

    await manager.connectAddrCallback(callback);

    expect(deps.getConnectAddrs).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("ws://a");
  });

  it("reuses cached addresses until they are exhausted", async () => {
    const deps = createDeps(["ws://a", "ws://b"]);
    const manager = new ImConnectAddressManager(deps);
    const callback = vi.fn();

    await manager.connectAddrCallback(callback);
    await manager.connectAddrCallback(callback);

    expect(deps.getConnectAddrs).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenNthCalledWith(1, "ws://a");
    expect(callback).toHaveBeenNthCalledWith(2, "ws://a");
  });

  it("rotates to the next address after a used address disconnects", async () => {
    const deps = createDeps(["ws://a", "ws://b", "ws://c"]);
    const manager = new ImConnectAddressManager(deps);
    const callback = vi.fn();

    await manager.connectAddrCallback(callback);
    manager.rotateAfterDisconnect();
    await manager.connectAddrCallback(callback);

    expect(callback).toHaveBeenNthCalledWith(1, "ws://a");
    expect(callback).toHaveBeenNthCalledWith(2, "ws://b");
  });

  it("does not rotate before any address has been used", async () => {
    const deps = createDeps(["ws://a", "ws://b"]);
    const manager = new ImConnectAddressManager(deps);
    const callback = vi.fn();

    manager.rotateAfterDisconnect();
    await manager.connectAddrCallback(callback);

    expect(callback).toHaveBeenCalledWith("ws://a");
  });

  it("does not callback when no address is available", async () => {
    const deps = createDeps([]);
    const manager = new ImConnectAddressManager(deps);
    const callback = vi.fn();

    await manager.connectAddrCallback(callback);

    expect(callback).not.toHaveBeenCalled();
  });
});
