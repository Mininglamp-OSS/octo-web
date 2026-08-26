/** @vitest-environment jsdom */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
    const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    return {
        handlers,
        bus: {
            on: (type: string, handler: (payload?: unknown) => void) => { (handlers[type] ??= []).push(handler); },
            off: (type: string, handler: (payload?: unknown) => void) => { handlers[type] = (handlers[type] ?? []).filter((item) => item !== handler); },
            emit: (type: string, payload?: unknown) => { (handlers[type] ?? []).forEach((handler) => handler(payload)); },
        },
    };
});

vi.mock("../../../App", () => ({ default: { mittBus: hoisted.bus, config: { appVersion: "test" }, loginInfo: { loginProvider: "" }, remoteConfig: { oidcProviders: [] }, shared: { logoutUserInitiated: vi.fn() } }, __esModule: true }));
vi.mock("../../../Utils/versionChecker", () => ({ checkVersionOnce: vi.fn().mockResolvedValue(null), checkVersionOnceWithStatus: vi.fn().mockResolvedValue({ status: "latest" }) }));
vi.mock("@douyinfe/semi-ui", () => ({ Button: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>, Progress: () => <div /> }));
vi.mock("../ChangelogMarkdown", () => ({ default: () => <div /> }));
vi.mock("../../WKModal", () => ({ default: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => visible ? <div>{children}</div> : null }));
vi.mock("../SettingsCenter", () => ({ default: (props: { visible: boolean; onClose: () => void; onOpenOnboarding?: () => void; openSecretsRequest?: unknown }) => props.visible ? <div data-testid="settings-center"><button onClick={props.onClose}>close</button><button data-testid="open-onboarding" onClick={props.onOpenOnboarding}>onboarding</button><span data-testid="secrets-request">{JSON.stringify(props.openSecretsRequest ?? null)}</span></div> : null }));

import NavSettingsPanel from "../NavSettingsPanel";

let container: HTMLDivElement;
const baseProps = {
    settingSelected: true,
    triggerRef: { current: null },
    hasNewVersion: false,
    showAppVersion: false,
    showAppUpdate: false,
    appUpdateProgress: 0,
    showAppUpdateOperation: false,
    onSetShowAppVersion: vi.fn(),
    onInstallUpdate: vi.fn(),
    onNotifyListener: vi.fn(),
};

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.keys(hoisted.handlers).forEach((key) => delete hoisted.handlers[key]);
});

afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
});

function render(onToggleSetting = vi.fn(), settingSelected = true, onOpenOnboarding = vi.fn()) {
    act(() => ReactDOM.render(<NavSettingsPanel {...baseProps} settingSelected={settingSelected} onToggleSetting={onToggleSetting} onOpenOnboarding={onOpenOnboarding} />, container));
    return onToggleSetting;
}

describe("NavSettingsPanel", () => {
    it("opens SettingsCenter directly without rendering the legacy flyout", () => {
        render();
        expect(container.querySelector('[data-testid="settings-center"]')).not.toBeNull();
        expect(container.querySelector(".wk-navrail__settings-list")).toBeNull();
    });

    it("closes the settings center through the shared setting state", () => {
        const onToggleSetting = render();
        act(() => (container.querySelector('[data-testid="settings-center"] button') as HTMLButtonElement).click());
        expect(onToggleSetting).toHaveBeenCalledTimes(1);
    });

    it("routes the secrets deep link into the settings center", () => {
        render();
        act(() => hoisted.bus.emit("wk:open-secrets", { create: true, value: "sk-test" }));
        expect(container.querySelector('[data-testid="secrets-request"]')?.textContent).toContain('"value":"sk-test"');
    });

    it("opens the settings center for a secrets deep link when it is closed", () => {
        const onToggleSetting = render(vi.fn(), false);
        act(() => hoisted.bus.emit("wk:open-secrets", { create: true }));
        expect(onToggleSetting).toHaveBeenCalledTimes(1);
    });

    it("closes the settings center before opening onboarding", () => {
        const onToggleSetting = vi.fn();
        const onOpenOnboarding = vi.fn();
        render(onToggleSetting, true, onOpenOnboarding);
        act(() => (container.querySelector('[data-testid="open-onboarding"]') as HTMLButtonElement).click());
        expect(onToggleSetting).toHaveBeenCalledTimes(1);
        expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
    });
});
