import { describe, expect, it, vi } from "vitest";
import {
  publishInitialSpaceResolution,
  requestGuardedSpaceChange,
  resolveInitialSpace,
  shouldPublishInitialSpaceChange,
} from "../Pages/Main/spaceChange";
import {
  requestGuardedBrowserRouteChange,
  requestGuardedMenuChange,
  requestProgrammaticMenuChange,
} from "../Pages/Main/menuChange";

describe("MainPage initial Space resolution", () => {
  it("falls back to an accessible Space when local storage belongs to another user", () => {
    const spaces = [{ space_id: "space-a" }, { space_id: "space-b" }];
    expect(resolveInitialSpace(spaces, "stale-space")).toEqual(spaces[0]);
    expect(resolveInitialSpace(spaces, "space-b")).toEqual(spaces[1]);
  });

  it("publishes the resolved Space only when startup changes the active Space", () => {
    expect(shouldPublishInitialSpaceChange("space-a", "space-b")).toBe(true);
    expect(shouldPublishInitialSpaceChange("space-a", "space-a")).toBe(false);
  });

  it("publishes one non-destructive ready event when cached Space is unchanged", () => {
    const emit = vi.fn();
    const space = { space_id: "space-a" };

    publishInitialSpaceResolution("space-a", space, emit);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("space-ready", space);
  });

  it("publishes a real change before the ready event when startup repairs Space", () => {
    const emit = vi.fn();
    const space = { space_id: "space-b" };

    publishInitialSpaceResolution("space-a", space, emit);

    expect(emit.mock.calls).toEqual([
      ["space-changed", space],
      ["space-ready", space],
    ]);
  });

  it("clears a stale Space when the user has no accessible Spaces", () => {
    expect(resolveInitialSpace([], "stale-space")).toBeUndefined();
    expect(shouldPublishInitialSpaceChange("stale-space", "")).toBe(false);
  });
});

describe("guarded menu changes", () => {
  it("does not mutate menu, URL, or route state when leaving Mail is cancelled", () => {
    const state = {
      menuId: "mail",
      path: "/mail",
      rightStack: ["records", "composer"],
    };
    const apply = vi.fn(() => {
      state.menuId = "chat";
      state.path = "/chat";
      state.rightStack = [];
    });
    const requestSwitch = vi.fn(() => false);

    expect(requestGuardedMenuChange("mail", "chat", requestSwitch, apply)).toBe(
      false
    );
    expect(apply).not.toHaveBeenCalled();
    expect(state).toEqual({
      menuId: "mail",
      path: "/mail",
      rightStack: ["records", "composer"],
    });
  });

  it("does not wrap the Mail menu's own guarded action twice", () => {
    const apply = vi.fn();
    const requestSwitch = vi.fn();

    expect(requestGuardedMenuChange("mail", "mail", requestSwitch, apply)).toBe(
      true
    );
    expect(requestSwitch).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("consults the workspace guard when a mounted composer outlives the Mail menu", () => {
    const apply = vi.fn();
    const requestSwitch = vi.fn(() => false);

    expect(
      requestGuardedMenuChange("chat", "summary", requestSwitch, apply)
    ).toBe(false);
    expect(requestSwitch).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("runs a programmatic switch callback only after a dirty Mail composer proceeds", () => {
    const order: string[] = [];
    let proceed: (() => void) | undefined;
    const requestSwitch = vi.fn((next: () => void) => {
      proceed = next;
      return false;
    });

    expect(
      requestProgrammaticMenuChange(
        "mail",
        "chat",
        requestSwitch,
        () => order.push("switch"),
        () => order.push("open-chat")
      )
    ).toBe(false);
    expect(order).toEqual([]);

    proceed?.();
    expect(order).toEqual(["switch", "open-chat"]);
  });

  it("does not switch or invoke the callback when an in-flight Mail operation vetoes", () => {
    const apply = vi.fn();
    const afterSwitch = vi.fn();

    expect(
      requestProgrammaticMenuChange(
        "mail",
        "summary",
        () => false,
        apply,
        afterSwitch
      )
    ).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(afterSwitch).not.toHaveBeenCalled();
  });

  it("keeps the current menu when a dirty Mail composer is cancelled", () => {
    const apply = vi.fn();
    const afterSwitch = vi.fn();
    const requestSwitch = vi.fn(() => false);

    expect(
      requestProgrammaticMenuChange(
        "mail",
        "chat",
        requestSwitch,
        apply,
        afterSwitch
      )
    ).toBe(false);
    expect(requestSwitch).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(afterSwitch).not.toHaveBeenCalled();
  });

  it("guards a destination action even when its menu is already active", () => {
    const apply = vi.fn();
    const afterSwitch = vi.fn();
    let proceed: (() => void) | undefined;
    const requestSwitch = vi.fn((next: () => void) => {
      proceed = next;
      return false;
    });

    expect(
      requestProgrammaticMenuChange(
        "chat",
        "chat",
        requestSwitch,
        apply,
        afterSwitch
      )
    ).toBe(false);
    expect(requestSwitch).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(afterSwitch).not.toHaveBeenCalled();

    proceed?.();
    expect(apply).not.toHaveBeenCalled();
    expect(afterSwitch).toHaveBeenCalledTimes(1);
  });
});

describe("guarded browser history changes", () => {
  it("restores the current route until a dirty composer approves Browser Back", () => {
    const event = { stopImmediatePropagation: vi.fn() };
    const restore = vi.fn();
    const replay = vi.fn();
    let proceed: (() => void) | undefined;

    expect(
      requestGuardedBrowserRouteChange(
        event,
        (next) => {
          proceed = next;
          return false;
        },
        restore,
        replay
      )
    ).toBe(false);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(replay).not.toHaveBeenCalled();

    proceed?.();
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("keeps the current route when an in-flight operation vetoes Browser Back", () => {
    const event = { stopImmediatePropagation: vi.fn() };
    const restore = vi.fn();
    const replay = vi.fn();

    expect(
      requestGuardedBrowserRouteChange(
        event,
        () => false,
        restore,
        replay
      )
    ).toBe(false);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(replay).not.toHaveBeenCalled();
  });

  it("preserves normal Browser Back behavior when no guard is active", () => {
    const event = { stopImmediatePropagation: vi.fn() };
    const restore = vi.fn();
    const replay = vi.fn();

    expect(
      requestGuardedBrowserRouteChange(
        event,
        (next) => {
          next();
          return true;
        },
        restore,
        replay
      )
    ).toBe(true);
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });
});

describe("guarded Space changes", () => {
  it("waits for the active workspace before applying a different Space", () => {
    const apply = vi.fn();
    let proceed: (() => void) | undefined;
    const requestSwitch = vi.fn((next: () => void) => {
      proceed = next;
      return false;
    });

    expect(
      requestGuardedSpaceChange("space-b", "space-a", requestSwitch, apply)
    ).toBe(false);
    expect(apply).not.toHaveBeenCalled();

    proceed?.();
    expect(apply).toHaveBeenCalledWith("space-b");
  });

  it("does not prompt or reapply when the selected Space is already active", () => {
    const apply = vi.fn();
    const requestSwitch = vi.fn();

    expect(
      requestGuardedSpaceChange("space-a", "space-a", requestSwitch, apply)
    ).toBe(true);
    expect(requestSwitch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
