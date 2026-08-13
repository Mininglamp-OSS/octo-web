import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/App.tsx", "utf8");

describe("clear-auth-session IPC wiring", () => {
  it("invokes cleanup only in Electron and does not block logout", () => {
    expect(appSource).toContain('const IPC_CLEAR_AUTH_SESSION = "octo:oidc:clear-auth-session"');
    expect(appSource).toMatch(/__POWERED_ELECTRON__\s*&&[\s\S]*ipc\?\.invoke/);
    expect(appSource).toContain("ipc.invoke(IPC_CLEAR_AUTH_SESSION)");
    expect(appSource).toMatch(/await\s+\(window as any\)\.ipc\.invoke\(IPC_CLEAR_AUTH_SESSION\)/);
    expect(appSource).toContain("catch {");
  });
});
