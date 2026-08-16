import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import MenusManager, { Menus } from "../Menus";

const menuId = "test-icon-override";

afterEach(() => {
  MenusManager.shared.register(menuId, () => undefined);
});

describe("MenusManager icon overrides", () => {
  it("applies and removes a host-owned icon override", () => {
    const originalIcon = <span>original</span>;
    const overrideIcon = <span>override</span>;
    MenusManager.shared.register(
      menuId,
      () => new Menus(menuId, "/test", "Test", originalIcon, originalIcon),
    );

    const removeOverride = MenusManager.shared.registerIconOverride(menuId, overrideIcon);

    const overridden = MenusManager.shared.menusList().find((menu) => menu.id === menuId);
    expect(overridden?.icon).toBe(overrideIcon);
    expect(overridden?.selectedIcon).toBe(overrideIcon);

    removeOverride();

    const restored = MenusManager.shared.menusList().find((menu) => menu.id === menuId);
    expect(restored?.icon).toBe(originalIcon);
    expect(restored?.selectedIcon).toBe(originalIcon);
  });
});
