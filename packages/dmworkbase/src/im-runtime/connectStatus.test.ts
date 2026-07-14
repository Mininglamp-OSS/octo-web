import { describe, expect, it, vi } from "vitest";
import { ConnectStatus } from "wukongimjssdk";
import { createImConnectStatusListener } from "./connectStatus";

function createDeps() {
  return {
    logout: vi.fn(),
    resetTyping: vi.fn(),
    rotateConnectAddress: vi.fn(),
  };
}

describe("createImConnectStatusListener", () => {
  it("logs out when the SDK reports ConnectKick", () => {
    const deps = createDeps();
    const listener = createImConnectStatusListener(deps);

    listener(ConnectStatus.ConnectKick);

    expect(deps.logout).toHaveBeenCalledTimes(1);
    expect(deps.resetTyping).not.toHaveBeenCalled();
    expect(deps.rotateConnectAddress).not.toHaveBeenCalled();
  });

  it("logs out when the SDK reports auth failure reason code", () => {
    const deps = createDeps();
    const listener = createImConnectStatusListener(deps);

    listener(ConnectStatus.Disconnect, 2);

    expect(deps.logout).toHaveBeenCalledTimes(1);
    expect(deps.resetTyping).not.toHaveBeenCalled();
    expect(deps.rotateConnectAddress).not.toHaveBeenCalled();
  });

  it("resets typing state after the connection is restored", () => {
    const deps = createDeps();
    const listener = createImConnectStatusListener(deps);

    listener(ConnectStatus.Connected);

    expect(deps.resetTyping).toHaveBeenCalledTimes(1);
    expect(deps.logout).not.toHaveBeenCalled();
    expect(deps.rotateConnectAddress).not.toHaveBeenCalled();
  });

  it("rotates the connect address after disconnect", () => {
    const deps = createDeps();
    const listener = createImConnectStatusListener(deps);

    listener(ConnectStatus.Disconnect);

    expect(deps.rotateConnectAddress).toHaveBeenCalledTimes(1);
    expect(deps.logout).not.toHaveBeenCalled();
    expect(deps.resetTyping).not.toHaveBeenCalled();
  });
});
