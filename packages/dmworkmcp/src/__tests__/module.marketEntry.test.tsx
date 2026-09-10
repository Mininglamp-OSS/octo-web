// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  registerNamespace: vi.fn(),
  registerRoute: vi.fn(),
  registerMenu: vi.fn(),
  routeGet: vi.fn(),
  popToRoot: vi.fn(),
  replaceToRoot: vi.fn(),
  syncPath: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  ChatPage: () => React.createElement("div", { "data-testid": "chat-page" }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  i18n: { registerNamespace: h.registerNamespace },
  t: (key: string) => key,
  Dap: { shared: { track: h.track } },
  Menus: class {
    onPress?: (reentry?: boolean) => void;

    constructor(
      public id: string,
      public routePath: string,
      public title: string,
      public icon: React.ReactElement,
      public selectedIcon: React.ReactElement
    ) {}
  },
  WKApp: {
    route: {
      register: h.registerRoute,
      get: h.routeGet,
      syncPath: h.syncPath,
    },
    routeLeft: { popToRoot: h.popToRoot },
    routeRight: { replaceToRoot: h.replaceToRoot },
    menus: { register: h.registerMenu },
  },
}));

vi.mock("@dmwork/skillmarket", () => ({
  SkillListPage: () => React.createElement("div", { "data-testid": "skills-page" }),
  SpaceReviewPage: () => React.createElement("div", { "data-testid": "review-page" }),
}));
vi.mock("../pages/McpMarketListPage", () => ({
  default: () => React.createElement("div", { "data-testid": "mcp-page" }),
}));
vi.mock("../pages/MyAssetsPage", () => ({ default: () => null }));
vi.mock("../pages/ExpertMarketListPage", () => ({ default: () => null }));
vi.mock("../components/MarketSidebar", () => ({ default: () => null }));

import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "../pages/McpMarketListPage";
import { McpMarketModule } from "../module";

beforeEach(() => {
  vi.clearAllMocks();
  h.routeGet.mockImplementation((path: string) => {
    const registration = h.registerRoute.mock.calls.find(([route]) => route === path);
    return registration?.[1]?.();
  });
});

describe("McpMarketModule market entry", () => {
  it("opens Skills from the top-level menu and keeps the connector deep link", () => {
    new McpMarketModule().init();

    const menuFactory = h.registerMenu.mock.calls.find(
      ([id]) => id === "mcp-market"
    )?.[1] as () => { onPress?: (reentry?: boolean) => void };
    const menu = menuFactory();
    menu.onPress?.(false);

    expect(h.routeGet).toHaveBeenCalledWith("/mcp-market/skills");
    expect(h.replaceToRoot.mock.calls[0][0].type).toBe(SkillListPage);
    expect(h.syncPath).toHaveBeenCalledWith("/mcp-market/skills");
    expect(h.track).toHaveBeenCalledWith("market_module_entered", {});

    const connectorFactory = h.registerRoute.mock.calls.find(
      ([path]) => path === "/mcp-market/mcp"
    )?.[1] as () => React.ReactElement;
    expect(connectorFactory().type).toBe(McpMarketListPage);
  });

  it("does not sync the Skills URL when the route cannot resolve", () => {
    new McpMarketModule().init();
    h.routeGet.mockReturnValue(undefined);

    const menuFactory = h.registerMenu.mock.calls.find(
      ([id]) => id === "mcp-market"
    )?.[1] as () => { onPress?: (reentry?: boolean) => void };
    menuFactory().onPress?.(false);

    expect(h.replaceToRoot).not.toHaveBeenCalled();
    expect(h.syncPath).not.toHaveBeenCalled();
  });
});
