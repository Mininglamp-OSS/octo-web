// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: {
    shared: { currentSpaceId: "space-a" },
  },
  remoteConfig: {
    disableUserCreateSpace: false,
    addConfigChangeListener: vi.fn(() => () => undefined),
  },
  unreadObserver: {
    getSnapshot: vi.fn(() => 0),
    listener: undefined as undefined | ((count: number) => void),
    subscribe: vi.fn((listener: (count: number) => void) => {
      mocks.unreadObserver.listener = listener;
      listener(mocks.unreadObserver.getSnapshot());
      return () => { mocks.unreadObserver.listener = undefined; };
    }),
  },
}));

vi.mock("../../../App", () => ({
  default: { ...mocks.app, remoteConfig: mocks.remoteConfig },
}));
vi.mock("../../../im-runtime/currentUnreadObserver", () => ({
  getCurrentImUnreadObserver: () => mocks.unreadObserver,
}));
vi.mock("../../../i18n", async () => {
  const ReactModule = await import("react");
  return {
    I18nContext: ReactModule.createContext({
      t: (key: string, options?: { values?: Record<string, unknown> }) => {
        const count = options?.values?.count;
        return count === undefined ? key : `${key}:${count}`;
      },
    }),
  };
});

import NavSpaceSwitcher from "../NavSpaceSwitcher";
import { spaceUnreadStore } from "../../../features/space-unread/store";

const spaces = [
  { space_id: "space-a", name: "A", member_count: 1, max_users: 0 },
  { space_id: "space-b", name: "B", member_count: 2, max_users: 0 },
] as any[];

beforeEach(() => {
  spaceUnreadStore.reset();
  mocks.app.shared.currentSpaceId = "space-a";
});
afterEach(() => cleanup());

describe("NavSpaceSwitcher unread badges", () => {
  it("keeps red new unread while open and converts it to gray total after close", () => {
    spaceUnreadStore.replaceTotals({ "space-b": 27 });
    spaceUnreadStore.recordIncoming("space-b", "m1");
    spaceUnreadStore.recordIncoming("space-b", "m2");
    spaceUnreadStore.recordIncoming("space-b", "m3");
    const view = render(
      <NavSpaceSwitcher spaces={spaces} currentSpaceId="space-a" onSpaceSelect={vi.fn()} />,
    );

    expect(view.container.querySelector(".wk-navrail__space-unread-badge")?.textContent).toBe("3");
    fireEvent.click(view.getByRole("button", {
      name: "base.navRail.spaceSwitcher.switchWithNewUnread:3",
    }));
    expect(document.querySelector(".wk-space-item__unread--new")?.textContent).toBe("3");
    expect(view.container.querySelector(".wk-navrail__space-unread-badge")?.textContent).toBe("3");

    fireEvent.click(document.querySelector(".wk-navrail__flyout-mask")!);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({});
    expect(view.container.querySelector(".wk-navrail__space-unread-badge")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "base.navRail.spaceSwitcher.switch" }));
    expect(document.querySelector(".wk-space-item__unread--total")?.textContent).toBe("30");
  });

  it("shows a check instead of a number for the current Space and caps display at 99+", () => {
    render(
      <NavSpaceSwitcher
        spaces={spaces}
        currentSpaceId="space-a"
        onSpaceSelect={vi.fn()}
        totalUnreadBySpace={{ "space-a": 5, "space-b": 120 }}
        newUnreadBySpace={{}}
      />,
    );
    fireEvent.click(document.querySelector(".wk-navrail__space-icon-btn")!);
    expect(document.querySelectorAll(".wk-space-item__check")).toHaveLength(1);
    expect(document.querySelectorAll(".wk-space-item__unread")).toHaveLength(1);
    expect(document.querySelector(".wk-space-item__unread")?.textContent).toBe("99+");
  });

  it("keeps the latest observed total when the current Space becomes non-current", () => {
    const view = render(
      <NavSpaceSwitcher spaces={spaces} currentSpaceId="space-a" onSpaceSelect={vi.fn()} />,
    );
    mocks.unreadObserver.listener?.(6);
    mocks.app.shared.currentSpaceId = "space-b";
    mocks.unreadObserver.listener?.(9);
    view.rerender(
      <NavSpaceSwitcher spaces={spaces} currentSpaceId="space-b" onSpaceSelect={vi.fn()} />,
    );
    expect(spaceUnreadStore.getSnapshot().totalBySpace).toEqual({ "space-a": 6, "space-b": 9 });
    fireEvent.click(document.querySelector(".wk-navrail__space-icon-btn")!);
    expect(document.querySelector(".wk-space-item__unread--total")?.textContent).toBe("6");
  });

  it("exposes entry and row unread counts to assistive technology", () => {
    const view = render(
      <NavSpaceSwitcher
        spaces={spaces}
        currentSpaceId="space-a"
        onSpaceSelect={vi.fn()}
        totalUnreadBySpace={{ "space-b": 7 }}
        newUnreadBySpace={{ "space-b": 3 }}
      />,
    );

    expect(view.getByRole("button", {
      name: "base.navRail.spaceSwitcher.switchWithNewUnread:3",
    })).toBeTruthy();
    fireEvent.click(view.getByRole("button", {
      name: "base.navRail.spaceSwitcher.switchWithNewUnread:3",
    }));
    expect(view.getByRole("img", {
      name: "base.navRail.spaceSwitcher.newUnread:3",
    })).toBeTruthy();
  });
});
