/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appState } = vi.hoisted(() => ({ appState: {
  shared: { notificationIsClose: false, isLogined: () => false },
  loginInfo: { realnameVerified: false },
  config: { appVersion: "test" },
  apiClient: { config: { apiURL: "https://example.test" } },
} }));

vi.mock("../../../App", () => ({ default: appState, ThemeMode: {} }));
vi.mock("../../MeInfo", () => ({ MeInfo: () => <div data-testid="me-info" /> }));
import WKApp from "../../../App";
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
  WKApp.shared.notificationIsClose = false;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

describe("SettingsPage notifications", () => {
  it("changes mute scope and persists notification toggle state", () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "notifications", labelKey: "base.navRail.settingsCenter.item.notifications" }} environment={environment} />, container));
    const scope = container.querySelector("select[aria-label=\"静音时关闭\"]") as HTMLSelectElement;
    act(() => {
      scope.value = "sound-and-popup";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(scope.value).toBe("sound-and-popup");

    const notificationToggle = container.querySelector("[aria-label=\"通知选项\"]") as HTMLInputElement;
    expect(notificationToggle).toBeTruthy();
    act(() => notificationToggle.click());
    expect(WKApp.shared.notificationIsClose).toBe(true);
  });

  it("shows unsupported permission state on web without Notification", () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "notifications", labelKey: "base.navRail.settingsCenter.item.notifications" }} environment={environment} />, container));
    expect(container.textContent).toContain("当前环境不支持");
    expect(container.querySelector("button")).toBeNull();
  });
});
