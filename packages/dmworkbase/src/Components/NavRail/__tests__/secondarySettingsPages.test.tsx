/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appState } = vi.hoisted(() => ({
  appState: {
    shared: { notificationIsClose: false, isLogined: () => false },
    loginInfo: { realnameVerified: false },
    config: { appVersion: "test" },
    apiClient: { config: { apiURL: "https://example.test" } },
  },
}));

vi.mock("../../../App", () => ({ default: appState, ThemeMode: {} }));
vi.mock("../../MeInfo", () => ({ MeInfo: () => <div data-testid="me-info" /> }));

import { i18n } from "../../../i18n";
import { SettingsPage } from "../settingsPages";

const environment = {
  target: "web" as const,
  shell: null,
  os: "unknown" as const,
  capabilities: new Set<never>(),
};

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

describe("secondary settings pages", () => {
  it("opens the account secrets action and external account center", () => {
    const onSecrets = vi.fn();
    act(() => ReactDOM.render(<SettingsPage item={{ id: "account", labelKey: "base.navRail.settingsCenter.item.account" }} environment={environment} accountCenterUrl="https://account.example.test" onSecrets={onSecrets} />, container));

    expect(container.querySelector('a[href="https://account.example.test"]')).toBeTruthy();
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("管理"))?.click());
    expect(onSecrets).toHaveBeenCalledTimes(1);
  });

  it("renders voice settings in the settings center", () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "voice", labelKey: "base.navRail.settingsCenter.item.voice" }} environment={environment} />, container));
    expect(container.textContent).toContain("语音输入");
    expect(container.textContent).toContain("音频设备");
    expect(container.textContent).not.toContain("OctoASR");
    expect(container.textContent).not.toContain("管理麦克风、快捷键和语音识别方式");
  });

  it("renders the fallback page for an unknown setting", () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "unknown", labelKey: "unknown" }} environment={environment} />, container));

    expect(container.textContent).toContain("设置");
    expect(container.textContent).toContain("设置项");
  });
});
