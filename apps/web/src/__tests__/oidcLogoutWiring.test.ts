import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("OIDC logout wiring", () => {
  it("runs post-logout cleanup before loading cached login state", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");
    const cleanupIdx = source.indexOf("consumeOidcPostLogoutCleanup()");
    const loadIdx = source.indexOf("WKApp.loginInfo.load(); // 加载登录信息");

    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeLessThan(loadIdx);
  });

  it("uses backend-issued end_session_url for user-initiated settings logout", () => {
    const appSource = readRepoFile("packages/dmworkbase/src/App.tsx");
    const navSource = readRepoFile("packages/dmworkbase/src/Components/NavRail/NavSettingsPanel.tsx");
    const spaceGateSource = readRepoFile("apps/web/src/Components/SpaceGate/index.tsx");
    const joinSpaceSource = readRepoFile("apps/web/src/Components/JoinSpacePage/index.tsx");

    expect(navSource).toContain("logoutUserInitiated");
    expect(spaceGateSource).toContain("logoutUserInitiated");
    expect(joinSpaceSource).toContain("logoutUserInitiated");
    expect(appSource).toContain("requestOidcLogout(providerId, token)");
    expect(appSource).toContain("safeEndSessionUrl(resp.end_session_url)");
    expect(appSource).toContain("window.location.href = endSessionUrl");
  });

  it("clears local auth state before redirecting to the IdP logout URL", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");
    const redirectBlockIdx = source.indexOf("if (endSessionUrl) {");
    const clearIdx = source.indexOf("this.clearLocalLoginState();", redirectBlockIdx);
    const markIdx = source.indexOf("markOidcPostLogoutCleanup();", redirectBlockIdx);
    const redirectIdx = source.indexOf("window.location.href = endSessionUrl", redirectBlockIdx);

    expect(redirectBlockIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeGreaterThan(redirectBlockIdx);
    expect(markIdx).toBeGreaterThan(clearIdx);
    expect(redirectIdx).toBeGreaterThan(markIdx);
  });
});
