/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
    checkVersionOnce: vi.fn(),
    logoutUserInitiated: vi.fn(),
    notificationIsClose: false,
}));

vi.mock("../../../App", () => ({
    default: {
        loginInfo: { loginProvider: "" },
        remoteConfig: { oidcProviders: [] },
        apiClient: { config: { apiURL: "/" } },
        shared: {
            get notificationIsClose() { return hoisted.notificationIsClose; },
            set notificationIsClose(next: boolean) { hoisted.notificationIsClose = next; },
            logoutUserInitiated: (...args: unknown[]) => hoisted.logoutUserInitiated(...args),
        },
    },
    __esModule: true,
}));

vi.mock("../../../Utils/versionChecker", () => ({
    checkVersionOnce: (...args: unknown[]) => hoisted.checkVersionOnce(...args),
}));

vi.mock("../NavVoiceSettingsItem", () => ({
    default: () => null,
}));

vi.mock("../NavSecretsSettingsItem", () => ({
    default: () => null,
}));

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: { error: vi.fn() },
    Spin: () => React.createElement("span", null, "spin"),
    Button: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("button", props, children),
    Progress: () => React.createElement("div", null, "progress"),
}));

vi.mock("../ChangelogMarkdown", () => ({
    default: ({ content }: { content: string }) => React.createElement("div", null, content),
}));

vi.mock("../../WKModal", () => ({
    default: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => visible ? React.createElement("div", null, children) : null,
}));

import NavSettingsPanel from "../NavSettingsPanel";

let container: HTMLDivElement;
let trigger: HTMLButtonElement;
const baseProps = {
    settingSelected: true,
    hasNewVersion: false,
    showNewVersion: false,
    showAppVersion: false,
    showAppUpdate: false,
    appUpdateProgress: 0,
    showAppUpdateOperation: false,
    onSetShowNewVersion: vi.fn(),
    onSetShowAppVersion: vi.fn(),
    onInstallUpdate: vi.fn(),
    onNotifyListener: vi.fn(),
};

beforeEach(() => {
    hoisted.checkVersionOnce.mockReset().mockResolvedValue(null);
    hoisted.logoutUserInitiated.mockReset().mockResolvedValue(undefined);
    hoisted.notificationIsClose = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    trigger = document.createElement("button");
    trigger.textContent = "settings";
    document.body.appendChild(trigger);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    trigger.remove();
    container.remove();
    document.querySelectorAll(".wk-navrail__flyout, .wk-navrail__flyout-mask").forEach((node) => node.remove());
    vi.clearAllMocks();
});

function renderPanel(onToggleSetting = vi.fn()) {
    act(() => {
        ReactDOM.render(
            <NavSettingsPanel
                {...baseProps}
                triggerRef={{ current: trigger }}
                onToggleSetting={onToggleSetting}
            />,
            container,
        );
    });
    return onToggleSetting;
}

describe("NavSettingsPanel", () => {
    it("renders settings actions as focusable menu items", () => {
        renderPanel();

        const flyout = document.body.querySelector(".wk-navrail__settings-list") as HTMLElement | null;
        expect(flyout?.getAttribute("role")).toBe("menu");
        expect(flyout?.querySelectorAll("button[role='menuitem']").length).toBeGreaterThan(0);
    });

    it("closes through the shared outside-click behavior", () => {
        const onToggleSetting = renderPanel();

        act(() => {
            (document.body.querySelector(".wk-navrail__flyout-mask") as HTMLDivElement).click();
        });

        expect(onToggleSetting).toHaveBeenCalledTimes(1);
    });

    it("closes through the shared Escape behavior", () => {
        const onToggleSetting = renderPanel();

        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(onToggleSetting).toHaveBeenCalledTimes(1);
    });

    it("runs an action item and requests close", () => {
        const onToggleSetting = renderPanel();
        const changelogItem = Array.from(document.body.querySelectorAll("button[role='menuitem']"))
            .find((button) => button.textContent?.includes("更新日志")) as HTMLButtonElement | undefined;
        expect(changelogItem).toBeTruthy();

        act(() => {
            changelogItem!.click();
        });

        expect(onToggleSetting).toHaveBeenCalledTimes(1);
        expect(baseProps.onSetShowNewVersion).toHaveBeenCalledWith(true);
    });
});
