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
  voiceSettingsStore.reset();
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
    voiceSettingsStore.set({ enabled: true });
    renderPage("shortcuts", { environment: { ...webEnvironment, os: "macos", capabilities: new Set(["voiceInput"]) } });
    expect(container.textContent).toContain("点按");
    expect(container.textContent).toContain("右 Option");
  });

  it("renders device resources and about page actions", async () => {
    renderPage("devices");
    expect(container.querySelectorAll("[data-resource-status]")).toHaveLength(6);
    expect(container.querySelector('a[href*="octo-android"]')).toBeTruthy();

    const onAbout = vi.fn();
    const onOpenOnboarding = vi.fn();
    renderPage("about", { onAbout, onOpenOnboarding });
    expect(container.textContent).toContain("Octo Web");
    act(() => container.querySelector(".wk-settings-center__about-update")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => container.querySelector("[aria-label=\"使用指南\"]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAbout).toHaveBeenCalledTimes(1);
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });
});
