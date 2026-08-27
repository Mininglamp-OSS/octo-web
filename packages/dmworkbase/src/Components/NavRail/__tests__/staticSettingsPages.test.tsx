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
vi.mock("../../../Service/apiFetch", () => ({ apiFetchJson: vi.fn(async () => ({})) }));

import { i18n } from "../../../i18n";
import { voiceSettingsStore } from "../../../Service/VoiceSettingsStore";
import { SettingsPage } from "../settingsPages";

const webEnvironment = {
  target: "web" as const,
  shell: null,
  os: "unknown" as const,
  capabilities: new Set<never>(),
};

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  voiceSettingsStore.set({ enabled: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

function renderPage(id: string, props: Partial<React.ComponentProps<typeof SettingsPage>> = {}) {
  act(() => ReactDOM.render(<SettingsPage item={{ id, labelKey: `base.navRail.settingsCenter.item.${id}` }} environment={webEnvironment} {...props} />, container));
}

describe("static settings pages", () => {
  it("changes the general language selection", () => {
    renderPage("general");
    const language = container.querySelector("select[aria-label=\"界面语言\"]") as HTMLSelectElement;
    act(() => {
      language.value = "en-US";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(i18n.getLocale()).toBe("en-US");
  });

  it("renders downloads as unavailable controls on web", () => {
    renderPage("downloads");
    expect(container.textContent).toContain("下载目录");
    expect(container.textContent).toContain("即将上线");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows voice shortcuts only when voice input is available", () => {
    renderPage("shortcuts", { environment: { ...webEnvironment, os: "macos", capabilities: new Set(["voiceInput"]) } });
    expect(container.textContent).toContain("按住说话");
    expect(container.textContent).toContain("右 Option");
  });

  it("hides voice shortcuts when voice input is disabled", () => {
    voiceSettingsStore.set({ enabled: false });
    renderPage("shortcuts", { environment: { ...webEnvironment, os: "macos", capabilities: new Set(["voiceInput"]) } });
    expect(container.textContent).toBe("");
  });

  it("renders device resources and about page actions", async () => {
    renderPage("devices");
    expect(container.querySelectorAll("[data-resource-status]")).toHaveLength(6);
    expect(container.querySelector('a[href*="octo-android"]')).toBeTruthy();

    const onAbout = vi.fn();
    const onOpenOnboarding = vi.fn();
    renderPage("about", { onAbout, onOpenOnboarding });
    expect(container.textContent).toContain("Octo Web");
    expect(container.textContent).toContain("检查是否有新版本，更新后刷新页面即可生效。");
    expect(container.querySelector(".wk-settings-center__about-update-actions")).toBeTruthy();
    act(() => (container.querySelector("[aria-label=\"使用指南\"]") as HTMLElement).click());
    renderPage("about", { environment: { ...webEnvironment, target: "desktop" }, onAbout, onOpenOnboarding });
    expect(container.querySelector(".wk-settings-center__about-update-actions")).toBeTruthy();
    act(() => (container.querySelector(".wk-settings-center__about-update") as HTMLElement).click());
    expect(onAbout).toHaveBeenCalledTimes(1);
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });

  it("shows about version actions on web and desktop", () => {
    renderPage("about");
    expect(container.querySelector(".wk-settings-center__about-update-actions")).toBeTruthy();
    expect(container.querySelector(".wk-settings-status-tag")?.textContent).toContain("尚未检查");
    expect(container.querySelector(".wk-settings-center__about-update")?.textContent).toBe("检查更新");

    renderPage("about", { environment: { ...webEnvironment, target: "desktop" } });
    expect(container.querySelector(".wk-settings-center__about-update-actions")).toBeTruthy();
    expect(container.querySelector(".wk-settings-status-tag")?.textContent).toContain("尚未检查");
    expect(container.querySelector(".wk-settings-center__about-update")?.textContent).toBe("检查更新");
  });

  it("keeps the about copy aligned with the version status", () => {
    renderPage("about", { aboutUpdateStatus: { status: "update", version: "2.0.0" } });
    expect(container.querySelector(".wk-settings-status-tag")?.textContent).toContain("发现新版本");
    expect(container.textContent).toContain("发现新版本，刷新页面后生效：2.0.0");
    expect(container.querySelector(".wk-settings-center__about-update")?.textContent).toBe("刷新");

    renderPage("about", { aboutUpdateStatus: { status: "failed" } });
    expect(container.querySelector(".wk-settings-status-tag")?.textContent).toContain("检查更新失败");
    expect(container.textContent).toContain("暂时无法确认版本状态");
  });
});
