/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appState, keepAwake } = vi.hoisted(() => ({
  appState: {
    shared: { notificationIsClose: false, isLogined: () => false },
    loginInfo: { realnameVerified: false },
    config: { appVersion: "test" },
    apiClient: { config: { apiURL: "https://example.test" } },
  },
  keepAwake: {
    getEnabled: vi.fn(async () => false),
    setEnabled: vi.fn(async (enabled: boolean) => enabled),
  },
}));

vi.mock("../../../App", () => ({ default: appState, ThemeMode: {} }));
vi.mock("../../MeInfo", () => ({ MeInfo: () => <div data-testid="me-info" /> }));
vi.mock("../../../Runtime/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../Runtime/adapters")>()),
  createKeepAwakeAdapter: () => keepAwake,
}));

import { i18n } from "../../../i18n";
import { SettingsPage } from "../settingsPages";

const environment = {
  target: "desktop" as const,
  shell: "electron" as const,
  os: "macos" as const,
  capabilities: new Set(["keepAwake"] as const),
};

let container: HTMLDivElement;

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  keepAwake.getEnabled.mockClear();
  keepAwake.setEnabled.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

describe("SettingsPage desktop behavior", () => {
  it("loads and saves the keep-awake setting", async () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "desktop-behavior", labelKey: "base.navRail.settingsCenter.item.desktopBehavior" }} environment={environment} />, container));
    await flush();

    const toggle = container.querySelector("[aria-label=\"保持电脑唤醒\"]") as HTMLInputElement;
    expect(keepAwake.getEnabled).toHaveBeenCalledTimes(1);
    expect(toggle.checked).toBe(false);

    act(() => toggle.click());
    await flush();

    expect(keepAwake.setEnabled).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(true);
  });
});
