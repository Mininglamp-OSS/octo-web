import { describe, it, expect } from "vitest";
import { reconcileMenuState, type MenuLike } from "../Pages/Main/menuReconcile";

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
});
