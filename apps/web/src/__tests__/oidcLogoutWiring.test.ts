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
    expect(source).toContain('kind: "desktop-idp"');
    expect(source).toContain('kind: "desktop-local"');
    expect(source).toContain('kind: "web-redirect"');
    expect(source).toContain('kind: "no-end-session"');
    expect(source).toContain('kind: "logout-error"');
    // Scheme gate: end-session URL must be https (RFC 8252 §8.10).
    expect(source).toMatch(/parsed\.protocol !== "https:"/);
  });

  it("filters the logout window navigation guard to the main frame", () => {
    // ZB3(a) regression: preventDefault() on `will-redirect` cancels the
    // entire top-level navigation, and both `will-redirect` and
    // `did-fail-load` carry an `isMainFrame` argument. If either listener
    // trips on a front-channel logout iframe (federated OPs load these
    // cross-origin), the whole logout flow settles(false) and the window is
    // destroyed mid-flow — cutting off the real main-frame end-session and
    // making the logout appear to succeed while other RPs' single-logout is
    // severed. Assert both listeners either delegate to the pure decision
    // helper (whose main-frame gate is unit-tested) or explicitly filter
    // isMainFrame themselves.
    const source = readRepoFile("apps/web/src-election/main/index.ts");
    // Guard delegates the isMainFrame gate to the pure helper.
    expect(source).toContain("decideLogoutWindowNavigation");
    // will-navigate uses arg-position (event, url, isMainFrame).
    expect(source).toMatch(
      /"will-navigate",\s*\(\s*event\s*,\s*navURL\s*,\s*isMainFrame\s*\)\s*=>/,
    );
    // will-redirect uses arg-position (event, url, isInPlace, isMainFrame).
    expect(source).toMatch(
      /"will-redirect",\s*\(\s*event\s*,\s*navURL\s*,\s*_isInPlace\s*,\s*isMainFrame\s*\)\s*=>/,
    );
    // did-fail-load filters both !isMainFrame and errorCode === -3 (aborted)
    // to match the pattern already used for the OIDC login window.
    expect(source).toMatch(/if\s*\(\s*!isMainFrame\s*\|\|\s*errorCode\s*===\s*-3\s*\)\s*return\s*;/);
  });

  it("distinguishes rejection reasons in the logout IPC log", () => {
    // ZB2 diagnostic ask: the previous handler emitted one generic warning
    // for every failure mode, so an operator whose missing entry was the
    // post_logout_redirect_uri target got pointed at the IdP list.
    // The rewritten log switches on the categorized reason returned by
    // validateOpenExternalUrl; grep for the two distinguishing hints so a
    // future refactor cannot silently drop them.
    const source = readRepoFile("apps/web/src-election/main/index.ts");
    expect(source).toContain('case "origin":');
    expect(source).toContain('case "redirect-origin":');
    expect(source).toContain("post_logout_redirect_uri origin is missing");
    // Never log the raw URL — end-session URLs carry id_token_hint/logout_hint.
    expect(source).not.toMatch(/url\.slice\(0,\s*200\)/);
  });
});
