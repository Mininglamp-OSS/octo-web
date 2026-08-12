import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

// This suite deliberately keeps only lightweight *wiring* checks — that the
// right entry points reference `logoutUserInitiated`, that the boot cleanup
// runs before login state is loaded, and that App.tsx delegates to the
// extracted `performOidcUserInitiatedLogout` helper. The actual desktop-vs-web
// branching, end-session-URL scheme rules, and fallback behavior are covered
// by behavioural tests in
// `packages/dmworkbase/src/Service/__tests__/oidcLogout.test.ts` (see the
// review notes P1-1 — grepping source text couldn't detect the earlier
// desktop / SSRF / interceptor bugs, but a behavioural test over the helper
// can).
describe("OIDC logout wiring", () => {
  it("runs post-logout cleanup before loading cached login state", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");
    const cleanupIdx = source.indexOf("consumeOidcPostLogoutCleanup()");
    const loadIdx = source.indexOf("WKApp.loginInfo.load(); // 加载登录信息");

    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeLessThan(loadIdx);
  });

  it("delegates user-initiated OIDC logout to the extracted helper", () => {
    const appSource = readRepoFile("packages/dmworkbase/src/App.tsx");
    const navSource = readRepoFile("packages/dmworkbase/src/Components/NavRail/NavSettingsPanel.tsx");
    const spaceGateSource = readRepoFile("apps/web/src/Components/SpaceGate/index.tsx");
    const joinSpaceSource = readRepoFile("apps/web/src/Components/JoinSpacePage/index.tsx");

    // Entry points must still call the class method — the underlying helper
    // is what we test behaviourally, but each caller keeps the same name so
    // logout UX (e.g. settings panel) does not regress silently.
    expect(navSource).toContain("logoutUserInitiated");
    expect(spaceGateSource).toContain("logoutUserInitiated");
    expect(joinSpaceSource).toContain("logoutUserInitiated");

    // App.tsx imports the extracted orchestration helper and delegates to it.
    // Behavioural coverage lives in oidcLogout.test.ts::performOidcUserInitiatedLogout.
    expect(appSource).toContain("performOidcUserInitiatedLogout");
    expect(appSource).toMatch(/async logoutUserInitiated\(\)\s*{[\s\S]*performOidcUserInitiatedLogout\(/);
    // Electron dev mode runs on http://localhost, so desktop detection must
    // use the preload marker/IPC bridge rather than file:// alone.
    expect(appSource).toMatch(/env:\s*this\.isElectronShell\(\)\s*\?\s*"desktop-shell"\s*:\s*"web"/);
    // The web branch continues to mark the post-logout cleanup key so the
    // next boot can consume it (regression guard for the file we test above).
    expect(appSource).toContain("markPostLogoutCleanup");
  });

  it("exposes the end-session URL policy in a single testable helper", () => {
    // The extracted helper owns every branch that used to live inline in
    // App.tsx: desktop-shell → local shell reload, web → location.href,
    // no-end-session → fallback local logout. Assert its API surface stays
    // stable so the behavioural tests remain meaningful.
    const source = readRepoFile("packages/dmworkbase/src/Service/oidcLogout.ts");
    expect(source).toContain("export async function performOidcUserInitiatedLogout");
    // Discriminated result: reviewers grep for these to trace call flow.
    expect(source).toContain('kind: "desktop-local"');
    expect(source).toContain('kind: "web-redirect"');
    expect(source).toContain('kind: "no-end-session"');
    expect(source).toContain('kind: "logout-error"');
    // Scheme gate: end-session URL must be https (RFC 8252 §8.10).
    expect(source).toMatch(/parsed\.protocol !== "https:"/);
  });
});
