import { describe, expect, it, vi } from "vitest";
import { runLogoutCleanup } from "../Service/logoutCleanup";

describe("clear-auth-session IPC wiring", () => {
  it("clears local state before the Electron auth session", async () => {
    const calls: string[] = [];
    const clearLocalLoginState = vi.fn(async () => calls.push("local"));
    const clearElectronAuthSession = vi.fn(async () => calls.push("electron"));

    await runLogoutCleanup(clearLocalLoginState, clearElectronAuthSession);

    expect(calls).toEqual(["local", "electron"]);
    expect(clearLocalLoginState).toHaveBeenCalledOnce();
    expect(clearElectronAuthSession).toHaveBeenCalledOnce();
  });
});
