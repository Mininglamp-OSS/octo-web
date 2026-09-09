import React from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  registerNamespace: vi.fn(),
  registerRoute: vi.fn(),
  registerMenu: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  i18n: { registerNamespace: state.registerNamespace },
  t: (key: string) => key,
  Menus: class {
    id: string;
    routePath: string;
    title: string;
    icon: React.ReactElement;
    selectedIcon: React.ReactElement;

    constructor(
      id: string,
      routePath: string,
      title: string,
      icon: React.ReactElement,
      selectedIcon: React.ReactElement
    ) {
      this.id = id;
      this.routePath = routePath;
      this.title = title;
      this.icon = icon;
      this.selectedIcon = selectedIcon;
    }
  },
  WKApp: {
    route: { register: state.registerRoute },
    menus: { register: state.registerMenu },
  },
}));

vi.mock("../AppBotPage", () => ({ default: () => null }));

import AppBotPage from "../AppBotPage";
import AppBotModule from "../module";

describe("AppBotModule Web contract", () => {
  it("preserves namespace, route, menu metadata, and idempotent initialization", () => {
    const module = new AppBotModule();

    expect(module.id()).toBe("AppBotModule");
    module.init();

    expect(state.registerNamespace).toHaveBeenCalledWith("appbot", {
      "zh-CN": expect.any(Object),
      "en-US": expect.any(Object),
    });
    expect(state.registerRoute).toHaveBeenCalledWith(
      "/appbot",
      expect.any(Function)
    );

    const routeFactory = state.registerRoute.mock
      .calls[0][1] as () => React.ReactElement;
    expect(routeFactory().type).toBe(AppBotPage);

    expect(state.registerMenu).toHaveBeenCalledWith(
      "appbot",
      expect.any(Function),
      6000
    );
    const menuFactory = state.registerMenu.mock.calls[0][1] as () => {
      id: string;
      routePath: string;
      title: string;
      icon: React.ReactElement;
      selectedIcon: React.ReactElement;
    };
    const menu = menuFactory();
    expect(menu).toMatchObject({
      id: "appbot",
      routePath: "/appbot",
      title: "appbot.menu.title",
    });
    expect(React.isValidElement(menu.icon)).toBe(true);
    expect(React.isValidElement(menu.selectedIcon)).toBe(true);
    expect(menu.selectedIcon.props.active).toBe(true);

    new AppBotModule().init();
    expect(state.registerNamespace).toHaveBeenCalledTimes(1);
    expect(state.registerRoute).toHaveBeenCalledTimes(1);
    expect(state.registerMenu).toHaveBeenCalledTimes(1);
  });
});
