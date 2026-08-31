/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appState } = vi.hoisted(() => ({
  appState: {
    loginInfo: {},
    remoteConfig: { oidcProviders: [] },
    config: { appVersion: "0.0.1", isDesktop: true },
    mittBus: { on: vi.fn(), off: vi.fn() },
    shared: { logoutUserInitiated: vi.fn() },
  },
}));

vi.mock("../../../App", () => ({ default: appState, ThemeMode: {} }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("../SettingsCenter", () => ({ default: () => null }));
vi.mock("../ChangelogMarkdown", () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock("../../WKModal", () => ({
  default: ({ visible, footer, children }: { visible: boolean; footer?: React.ReactNode; children: React.ReactNode }) => visible ? (
    <div>
      <div data-testid="modal-body">{children}</div>
      <div data-testid="modal-footer">{footer}</div>
    </div>
  ) : null,
}));
vi.mock("../../WKButton", () => ({
  default: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
}));
vi.mock("../../../electron/desktopBridge", () => ({
  isElectronPowered: () => true,
  sendElectronCheckUpdate: vi.fn(),
}));
vi.mock("../../../Utils/versionChecker", () => ({ checkVersionOnceWithStatus: vi.fn() }));
vi.mock("../../../assets/update-rocket.svg", () => ({ default: "update-rocket.svg" }));

import { i18n } from "../../../i18n";
import NavSettingsPanel, { type NavSettingsPanelProps } from "../NavSettingsPanel";

let container: HTMLDivElement;

const baseProps: NavSettingsPanelProps = {
  settingSelected: false,
  showAppVersion: true,
  showAppUpdate: false,
  appUpdateProgress: 0,
  appUpdateDownloadedBytes: 0,
  showAppUpdateOperation: true,
  lastVersionInfo: { appVersion: "0.0.2", updateDesc: "changes" },
  onToggleSetting: vi.fn(),
  onSetShowAppVersion: vi.fn(),
  onInstallUpdate: vi.fn(),
  onCancelUpdateDownload: vi.fn(),
  onQuitApp: vi.fn(),
  onNotifyListener: vi.fn(),
};

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
  vi.clearAllMocks();
});

function renderPanel(props: Partial<NavSettingsPanelProps> = {}) {
  act(() => ReactDOM.render(<NavSettingsPanel {...baseProps} {...props} />, container));
}

describe("NavSettingsPanel updater modal states", () => {
  it("shows cancel and update actions before downloading a normal update", () => {
    renderPanel();

    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toContain("取消");
    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toContain("更新");
  });

  it("shows cancel while a normal update is downloading", () => {
    renderPanel({ showAppUpdate: true, showAppUpdateOperation: false, appUpdateProgress: 42 });

    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toContain("取消");
    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).not.toContain("更新");
  });

  it("keeps a forced update escapable with quit and update actions", () => {
    renderPanel({ lastVersionInfo: { appVersion: "0.0.2", updateDesc: "changes", forceUpdate: true } });

    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toContain("退出 Octo");
    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toContain("更新");
  });

  it("does not render a dead install action after the package is already downloaded", () => {
    renderPanel({ showAppUpdate: false, showAppUpdateOperation: false, appUpdateProgress: 100 });

    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).not.toContain("安装");
    expect(container.querySelector("[data-testid=\"modal-footer\"]")?.textContent).toBe("");
  });
});
