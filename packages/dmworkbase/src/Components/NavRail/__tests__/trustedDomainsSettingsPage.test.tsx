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

import { i18n } from "../../../i18n";
import TrustedDomainsSettingsPage from "../TrustedDomainsSettingsPage";

const desktopEnvironment = {
  target: "desktop" as const,
  shell: "electron" as const,
  os: "unknown" as const,
  capabilities: new Set(["keepAwake"] as const),
};

const webEnvironment = {
  target: "web" as const,
  shell: null,
  os: "unknown" as const,
  capabilities: new Set<never>(),
};

let container: HTMLDivElement;
let invoke: ReturnType<typeof vi.fn>;

const flush = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === "trusted-domains-get") return ["example.com", "onprem.example:8443"];
    if (channel === "trusted-domain-remove") {
      return (args[0] === "example.com" ? ["onprem.example:8443"] : ["example.com"]);
    }
    return undefined;
  });
  Object.defineProperty(window, "ipc", { configurable: true, value: { invoke } });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
  delete (window as Window & { ipc?: unknown }).ipc;
});

describe("TrustedDomainsSettingsPage", () => {
  it("loads the persisted host list and removes an entry through IPC", async () => {
    act(() => {
      ReactDOM.render(
        <TrustedDomainsSettingsPage environment={desktopEnvironment} />,
        container,
      );
    });
    await flush();

    expect(invoke).toHaveBeenCalledWith("trusted-domains-get");
    expect(container.textContent).toContain("example.com");
    expect(container.textContent).toContain("onprem.example:8443");

    const removeButtons = Array.from(container.querySelectorAll("button"));
    const removeExample = removeButtons.find(
      (button) => button.textContent === "移除" && button.closest(".wk-settings-center__row")?.textContent?.includes("example.com"),
    );
    expect(removeExample).toBeTruthy();
    act(() => removeExample?.click());
    await flush();

    expect(invoke).toHaveBeenCalledWith("trusted-domain-remove", "example.com");
    expect(container.textContent).not.toContain("example.com");
    expect(container.textContent).toContain("onprem.example:8443");
  });

  it("shows the empty state when no hosts are persisted", async () => {
    invoke = vi.fn(async () => []);
    Object.defineProperty(window, "ipc", { configurable: true, value: { invoke } });
    act(() => {
      ReactDOM.render(
        <TrustedDomainsSettingsPage environment={desktopEnvironment} />,
        container,
      );
    });
    await flush();

    expect(container.textContent).toContain("暂无已信任域名");
  });

  it("renders an unsupported note on web without calling IPC", async () => {
    act(() => {
      ReactDOM.render(
        <TrustedDomainsSettingsPage environment={webEnvironment} />,
        container,
      );
    });
    await flush();

    expect(container.textContent).toContain("当前环境不支持管理已信任域名");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the list on a remove failure and surfaces an error toast", async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === "trusted-domains-get") return ["example.com"];
      throw new Error("write failed");
    });
    Object.defineProperty(window, "ipc", { configurable: true, value: { invoke } });
    act(() => {
      ReactDOM.render(
        <TrustedDomainsSettingsPage environment={desktopEnvironment} />,
        container,
      );
    });
    await flush();

    const removeButton = container.querySelector("button");
    expect(removeButton?.textContent).toBe("移除");
    act(() => removeButton?.click());
    await flush();

    expect(container.textContent).toContain("example.com");
  });
});
