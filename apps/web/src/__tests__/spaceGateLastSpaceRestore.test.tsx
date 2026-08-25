import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMySpaces: vi.fn(),
  notifyListener: vi.fn(),
  addConfigChangeListener: vi.fn(() => vi.fn()),
  app: {
    loginInfo: { uid: "user-a" },
    shared: {
      currentSpaceId: "",
      spaceChecked: false,
      notifyListener: vi.fn(),
      logoutUserInitiated: vi.fn(),
    },
    remoteConfig: {
      disableUserCreateSpace: false,
      addConfigChangeListener: vi.fn(() => vi.fn()),
    },
  },
}));

vi.mock("@octo/base", () => ({
  I18nContext: React.createContext({}),
  WKApp: mocks.app,
  SpaceService: { shared: { getMySpaces: mocks.getMySpaces } },
  SpaceCreate: () => null,
  t: (key: string) => key,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: () => null,
  Input: () => null,
  Spin: () => null,
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("lucide-react", () => ({ LogOut: () => null }));

import SpaceGate from "../Components/SpaceGate";

describe("SpaceGate last organization restore", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.app.loginInfo.uid = "user-a";
    mocks.app.shared.currentSpaceId = "";
    mocks.app.shared.spaceChecked = false;
    mocks.getMySpaces.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the current UID preference after currentSpaceId was cleared", async () => {
    localStorage.setItem("octo:last-space:user-a", "space-b");
    mocks.getMySpaces.mockResolvedValue([
      { space_id: "space-a" },
      { space_id: "space-b" },
    ]);
    const gate = new SpaceGate({});
    gate.forceUpdate = vi.fn();

    gate.componentDidMount();
    await vi.waitFor(() => {
      expect(mocks.app.shared.currentSpaceId).toBe("space-b");
    });

    expect(localStorage.getItem("currentSpaceId")).toBe("space-b");
    gate.componentWillUnmount();
  });
});
