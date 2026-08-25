import { describe, expect, it, vi } from "vitest";
import {
  publishInitialSpaceResolution,
  requestGuardedSpaceChange,
  shouldPublishInitialSpaceChange,
} from "../Pages/Main/spaceChange";
import {
  clearLastSpaceId,
  getLastSpaceStorageKey,
  persistActiveSpace,
  readLastSpaceId,
  resolveInitialSpace,
  resolveInitialSpaceForUser,
} from "../features/spacePreference";
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

  it("restores the current user's last accessible Space", () => {
    const spaces = [{ space_id: "space-a" }, { space_id: "space-b" }];

    expect(resolveInitialSpace(spaces, null, "space-b")).toEqual(spaces[1]);
  });

  it("keeps explicit and current-session choices ahead of device history", () => {
    const spaces = [
      { space_id: "space-a" },
      { space_id: "space-b" },
      { space_id: "space-c" },
    ];

    expect(
      resolveInitialSpace(spaces, "space-c", "space-b", "space-a")
    ).toEqual(spaces[2]);
  });

  it("uses one user-scoped resolution path after legacy migration", () => {
    const spaces = [
      { space_id: "space-a" },
      { space_id: "space-b" },
      { space_id: "space-c" },
    ];
    const values = new Map<string, string>([
      ["currentSpaceId", "space-b"],
      ["octo:last-space:user-a", "space-c"],
    ]);
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(
      resolveInitialSpaceForUser(spaces, "user-a", "space-a", store)
    ).toEqual(spaces[0]);
    expect(resolveInitialSpaceForUser(spaces, "user-a", null, store)).toEqual(
      spaces[2]
    );
    values.delete("octo:last-space:user-a");
    expect(resolveInitialSpaceForUser(spaces, "user-a", null, store)).toEqual(
      spaces[0]
    );
  });

  it("ignores an inaccessible historical Space and uses the first accessible Space", () => {
    const spaces = [{ space_id: "space-a" }, { space_id: "space-b" }];

    expect(resolveInitialSpace(spaces, null, "removed-space")).toEqual(
      spaces[0]
    );
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

describe("per-user last Space persistence", () => {
  it("migrates a legacy-only currentSpaceId to the current uid once", () => {
    const values = new Map<string, string>([
      ["currentSpaceId", "space-b"],
    ]);
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const spaces = [{ space_id: "space-a" }, { space_id: "space-b" }];

    expect(resolveInitialSpaceForUser(spaces, "user-a", null, store)).toEqual(
      spaces[1]
    );
    expect(values.get("octo:last-space:user-a")).toBe("space-b");
    expect(values.get("octo:last-space-legacy-migration:v1")).toBe("1");

    expect(resolveInitialSpaceForUser(spaces, "user-b", null, store)).toEqual(
      spaces[0]
    );
    expect(values.has("octo:last-space:user-b")).toBe(false);
  });

  it("isolates the last Space by uid while keeping currentSpaceId compatible", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    persistActiveSpace("user-a", "space-a", store);
    persistActiveSpace("user-b", "space-b", store);

    expect(values.get("currentSpaceId")).toBe("space-b");
    expect(readLastSpaceId("user-a", store)).toBe("space-a");
    expect(readLastSpaceId("user-b", store)).toBe("space-b");
  });

  it("does not persist an account preference without a uid", () => {
    const setItem = vi.fn();

    persistActiveSpace("", "space-a", { setItem });

    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith("currentSpaceId", "space-a");
    expect(getLastSpaceStorageKey("  ")).toBeUndefined();
    expect(getLastSpaceStorageKey(undefined)).toBeUndefined();
  });

  it("restores the same user's last Space after logout clears currentSpaceId", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const spaces = [{ space_id: "space-a" }, { space_id: "space-b" }];

    persistActiveSpace("user-a", "space-b", store);
    values.delete("currentSpaceId");

    expect(resolveInitialSpaceForUser(spaces, "user-a", null, store)).toEqual(
      spaces[1]
    );
  });

  it("does not resurrect the last Space after an empty membership result", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    persistActiveSpace("user-a", "space-a", store);
    expect(resolveInitialSpaceForUser([], "user-a", "space-a", store)).toBe(
      undefined
    );

    clearLastSpaceId("user-a", store);
    store.removeItem("currentSpaceId");

    expect(readLastSpaceId("user-a", store)).toBeNull();
    expect(values.has("octo:last-space:user-a")).toBe(false);
  });

  it("degrades safely when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    };

    expect(() =>
      persistActiveSpace("user-a", "space-a", unavailableStorage)
    ).not.toThrow();
    expect(readLastSpaceId("user-a", unavailableStorage)).toBeNull();
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
