import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "vitest";
import { reconcileMenuState, type MenuLike } from "../Pages/Main/menuReconcile";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

// Behavioral coverage for the #536 reviewer follow-up (Jerry-Xin + yujiawei): when a
// remote-config-gated menu (e.g. docs_on) is toggled OFF while it is the active view,
// reconciliation must drop its cached route (so the view unmounts / collab WS tears down) and
// fall back to the first available menu — otherwise the NavRail entry disappears but the route
// keeps rendering via historyRoutePaths. Turning a menu ON must never move the user.
//
// Tested against the pure `reconcileMenuState` helper so it needs no @octo/base module graph;
// MainVM.reconcileActiveMenu is a thin adapter that copies the result onto its private state.

const chat: MenuLike = { id: "chat", routePath: "/chat" };
const docs: MenuLike = { id: "docs", routePath: "/docs" };

describe("reconcileMenuState — config-gated menu disappearance", () => {
  it("falls back to the first menu and drops the route when the active menu is gated off", () => {
    // User is on Docs; docs_on flips false → docs leaves the list.
    const result = reconcileMenuState({
      menusList: [chat], // post-toggle: docs gone
      currentMenu: docs,
      historyRoutePaths: ["/chat", "/docs"],
    });

    expect(result.changed).toBe(true);
    expect(result.currentMenu?.id).toBe("chat"); // reconciled to first available
    expect(result.historyRoutePaths).not.toContain("/docs"); // stale route dropped → unmounts
    expect(result.historyRoutePaths).toContain("/chat");
  });

  it("is a no-op when the active menu is still present", () => {
    const result = reconcileMenuState({
      menusList: [chat, docs],
      currentMenu: chat,
      historyRoutePaths: ["/chat"],
    });
    expect(result.changed).toBe(false);
    expect(result.currentMenu?.id).toBe("chat");
    expect(result.historyRoutePaths).toEqual(["/chat"]);
  });

  it("does not move the user when a menu is turned ON (one-directional)", () => {
    // docs just appeared, user is on chat → chat still present → no change.
    const result = reconcileMenuState({
      menusList: [chat, docs],
      currentMenu: chat,
      historyRoutePaths: ["/chat"],
    });
    expect(result.changed).toBe(false);
    expect(result.currentMenu?.id).toBe("chat");
  });

  it("handles no active menu gracefully", () => {
    const result = reconcileMenuState({
      menusList: [chat],
      currentMenu: undefined,
      historyRoutePaths: [],
    });
    expect(result.changed).toBe(false);
    expect(result.currentMenu).toBeUndefined();
  });

  it("clears the active menu when the list becomes empty", () => {
    const result = reconcileMenuState({
      menusList: [],
      currentMenu: docs,
      historyRoutePaths: ["/docs"],
    });
    expect(result.changed).toBe(true);
    expect(result.currentMenu).toBeUndefined();
    expect(result.historyRoutePaths).not.toContain("/docs");
  });

  // #536 round-2 reviewer follow-up (yujiawei/OctoBoooot/Jerry-Xin): a menu gated off while the
  // user is on a *different* tab must still be pruned from history — otherwise the hidden
  // subtree (and anything it pushed outside historyRoutePaths, e.g. the docs editor in the
  // shared right pane) lingers forever, since it's no longer reachable from the NavRail.
  it("drops a gated-off menu's route even when it is not the active tab", () => {
    // User is on chat; docs was visited earlier (hidden, display:none) and is now gated off.
    const result = reconcileMenuState({
      menusList: [chat], // post-toggle: docs gone
      currentMenu: chat,
      historyRoutePaths: ["/chat", "/docs"],
    });

    expect(result.changed).toBe(true); // history shrank → caller must re-render
    expect(result.currentMenu?.id).toBe("chat"); // active tab is untouched
    expect(result.historyRoutePaths).toEqual(["/chat"]);
    expect(result.prunedRoutePaths).toEqual(["/docs"]);
  });

  it("reports no pruned routes when nothing disappeared", () => {
    const result = reconcileMenuState({
      menusList: [chat, docs],
      currentMenu: chat,
      historyRoutePaths: ["/chat"],
    });
    expect(result.prunedRoutePaths).toEqual([]);
  });

  it("reports the vanished route as pruned when the active menu itself disappears", () => {
    const result = reconcileMenuState({
      menusList: [chat],
      currentMenu: docs,
      historyRoutePaths: ["/chat", "/docs"],
    });
    expect(result.prunedRoutePaths).toEqual(["/docs"]);
  });

  // #536 round-4 reviewer follow-up: `activeMenuVanished` is the signal the caller uses to decide
  // whether to also clear the shared right-hand pane (WKApp.routeRight). It must be true only
  // when the *active* menu vanished, and false when merely a hidden/background tab was pruned —
  // otherwise clearing routeRight on every prune would wipe an unrelated active view (e.g. chat
  // pushes its own content into the same shared pane).
  it("reports activeMenuVanished=true only when the active menu itself disappeared", () => {
    const activeGoneResult = reconcileMenuState({
      menusList: [chat],
      currentMenu: docs,
      historyRoutePaths: ["/chat", "/docs"],
    });
    expect(activeGoneResult.activeMenuVanished).toBe(true);

    const hiddenTabPrunedResult = reconcileMenuState({
      menusList: [chat], // docs gone, but it wasn't the active menu
      currentMenu: chat,
      historyRoutePaths: ["/chat", "/docs"],
    });
    expect(hiddenTabPrunedResult.activeMenuVanished).toBe(false);
    expect(hiddenTabPrunedResult.prunedRoutePaths).toEqual(["/docs"]); // still pruned from history

    const noOpResult = reconcileMenuState({
      menusList: [chat, docs],
      currentMenu: chat,
      historyRoutePaths: ["/chat"],
    });
    expect(noOpResult.activeMenuVanished).toBe(false);
  });
});

// #536 round-3/4 reviewer follow-up (yujiawei/OctoBoooot/Jerry-Xin, converged after
// back-and-forth): dropping a route from `historyRoutePaths` only unmounts what that route
// renders directly there. The docs editor instead lives in the shared right-hand pane
// (WKApp.routeRight, pushed via `routeRight.replaceToRoot`), which `historyRoutePaths` pruning
// never touches — so its collab WebSocket kept running after `docs_on` was gated off while docs
// was the active tab. Fix: MainVM.reconcileActiveMenu additionally clears `WKApp.routeRight`
// when the active menu itself vanished (mirroring what a manual menu switch already does — see
// onMenuClick in Pages/Main/index.tsx). Gating on `activeMenuVanished` rather than "any route
// pruned" matters: routeRight is shared with whatever menu is currently active (e.g. chat pushes
// its own content there too, see EndpointCommon.tsx), so clearing it whenever some unrelated
// background tab is pruned would wipe an open chat conversation. Verified here via source
// assertion (same house style as docsOn.test.ts / disableUserCreateSpace.test.ts) since
// MainVM.reconcileActiveMenu is a thin adapter over the fully execution-tested
// `reconcileMenuState` above; a real @octo/base WKApp instance would pull in the full heavy
// module graph these tests deliberately avoid.
describe("MainVM.reconcileActiveMenu — releases the shared right pane only when the active menu vanishes", () => {
  it("gates WKApp.routeRight.popToRoot() on activeMenuVanished, not on any prune", () => {
    const source = readRepoFile("apps/web/src/Pages/Main/vm.ts");

    expect(source).toContain("result.activeMenuVanished");
    expect(source).toContain("WKApp.routeRight.popToRoot()");
    // Must NOT regress to clearing on every prune, which would also wipe an active menu's own
    // right-pane content (e.g. chat's open conversation) whenever an unrelated background tab
    // is dropped from history at the same time.
    expect(source).not.toContain("result.prunedRoutePaths.length > 0");

    const guardIdx = source.indexOf("result.activeMenuVanished");
    const popIdx = source.indexOf("WKApp.routeRight.popToRoot()");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(popIdx).toBeGreaterThan(guardIdx);
  });
});
