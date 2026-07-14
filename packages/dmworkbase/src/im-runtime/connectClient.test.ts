import { describe, expect, it, vi } from "vitest";
import { connectImClient, type ImConnectClientSdk } from "./connectClient";

function createSdk(): ImConnectClientSdk {
  return {
    config: {
      uid: "",
      token: "",
    },
    connect: vi.fn(),
  };
}

describe("connectImClient", () => {
  it("sets uid and token before connecting", () => {
    const sdk = createSdk();

    connectImClient({
      sdk,
      loginInfo: {
        uid: "user-1",
        token: "token-1",
      },
    });

    expect(sdk.config.uid).toBe("user-1");
    expect(sdk.config.token).toBe("token-1");
    expect(sdk.connect).toHaveBeenCalledTimes(1);
  });

  it("uses the latest login info on repeated connect", () => {
    const sdk = createSdk();

    connectImClient({
      sdk,
      loginInfo: {
        uid: "user-1",
        token: "token-1",
      },
    });
    connectImClient({
      sdk,
      loginInfo: {
        uid: "user-2",
        token: "token-2",
      },
    });

    expect(sdk.config.uid).toBe("user-2");
    expect(sdk.config.token).toBe("token-2");
    expect(sdk.connect).toHaveBeenCalledTimes(2);
  });
});
