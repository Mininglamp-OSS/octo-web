import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { expect } from "storybook/test";
import NavRail from "./index";
import type { NavRailProps } from "./index";
import NavBottom from "./NavBottom";
import NavSpaceSwitcher from "./NavSpaceSwitcher";
import NavSettingsPanel from "./NavSettingsPanel";
import { NAV_RAIL_EXPANDED_WIDTH } from "../WKLayout/layoutWidth";
import { Menus } from "../../Service/Menus";
import "../../theme/index.css";

const mockSpaces = [
    { space_id: "s1", name: "Demo Space", logo: "", member_count: 8, max_users: 50 },
    { space_id: "s2", name: "产品团队", logo: "", member_count: 3, max_users: 10 },
    { space_id: "s3", name: "研发中心", logo: "", member_count: 20, max_users: 0 },
] as any[];

function Icon({ label }: { label: string }) {
    return <span aria-hidden="true" style={{ fontSize: 16 }}>{label}</span>;
}

const messagesMenu = new Menus("messages", "/chat", "会话", <Icon label="💬" />, <Icon label="💬" />);
const contactsMenu = new Menus("contacts", "/contacts", "通讯录", <Icon label="👥" />, <Icon label="👥" />);

const defaultArgs: NavRailProps = {
    menusList: [messagesMenu, contactsMenu],
    currentMenus: messagesMenu,
    settingSelected: false,
    hasNewVersion: false,
    showAppVersion: false,
    showAppUpdate: false,
    appUpdateProgress: 0,
    showAppUpdateOperation: false,
    spaces: mockSpaces,
    currentSpaceId: "s1",
    onMenuClick: (menus) => console.log("nav menu clicked:", menus.id),
    onToggleSetting: () => console.log("settings toggled"),
    onSetShowAppVersion: (v) => console.log("show app version:", v),
    onInstallUpdate: () => console.log("install update"),
    onNotifyListener: () => console.log("notify listener"),
    onAvatarClick: () => console.log("avatar"),
    onSpaceSelect: (id) => console.log("space selected:", id),
    onJoinSpace: () => console.log("join space"),
    onCreateSpace: () => console.log("create space"),
};

const meta: Meta<typeof NavRail> = {
    title: "Navigation/NavRail",
    component: NavRail,
    parameters: {
        layout: "fullscreen",
        backgrounds: {
            default: "dark",
            values: [
                { name: "dark", value: "#111318" },
                { name: "light", value: "#f5f5f5" },
            ],
        },
    },
    decorators: [
        (Story) => (
            <div style={{ display: "flex", height: "100vh" }}>
                <Story />
                <div style={{ flex: 1, background: "var(--wk-bg-base, #171921)" }} />
            </div>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof NavRail>;

export const Default: Story = {
    args: defaultArgs,
};

export const UpdateCheckOpen: StoryObj = {
    name: "检查更新弹框（打开）",
    render: () => (
        <NavSettingsPanel
            settingSelected={false}
            showAppVersion
            showAppUpdate={false}
            appUpdateProgress={0}
            showAppUpdateOperation
            lastVersionInfo={{
                appVersion: "2.0.0",
                updateDesc: "本次更新：优化消息体验\n\n- 修复若干问题\n- 提升稳定性",
            }}
            onToggleSetting={() => undefined}
            onSetShowAppVersion={() => undefined}
            onInstallUpdate={() => undefined}
            onCancelUpdateDownload={() => undefined}
            onNotifyListener={() => undefined}
        />
    ),
};

export const UpdateInProgress: StoryObj = {
    name: "更新中弹框",
    render: () => (
        <NavSettingsPanel
            settingSelected={false}
            showAppVersion
            showAppUpdate
            appUpdateProgress={62}
            showAppUpdateOperation={false}
            lastVersionInfo={{ appVersion: "2.0.0", updateDesc: "" }}
            onToggleSetting={() => undefined}
            onSetShowAppVersion={() => undefined}
            onInstallUpdate={() => undefined}
            onCancelUpdateDownload={() => undefined}
            onNotifyListener={() => undefined}
        />
    ),
};

export const SettingsFlyoutOpen: Story = {
    name: "设置弹层（真实组件）",
    args: { ...defaultArgs, settingSelected: true },
};

function BottomLanguageOpen() {
    const containerRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const button = containerRef.current?.querySelector<HTMLButtonElement>(".wk-navrail__language");
        button?.click();
    }, []);
    return (
        <div ref={containerRef} className="wk-navrail" style={{ height: 220, justifyContent: "flex-end" }}>
            <NavBottom
                spaces={mockSpaces as any[]}
                currentSpaceId="s1"
                onSpaceSelect={(id) => console.log("space selected:", id)}
            />
        </div>
    );
}

export const LanguageFlyoutOpen: StoryObj = {
    name: "语言弹层（真实组件）",
    render: () => <BottomLanguageOpen />,
};

function SpaceOpen() {
    const containerRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const button = containerRef.current?.querySelector<HTMLButtonElement>(".wk-navrail__space-icon-btn");
        button?.click();
    }, []);
    return (
        <div ref={containerRef} className="wk-navrail" style={{ height: 220, justifyContent: "flex-end" }}>
            <NavSpaceSwitcher
                spaces={mockSpaces as any[]}
                currentSpaceId="s1"
                onSpaceSelect={(id) => console.log("space selected:", id)}
                onJoinSpace={() => console.log("join space")}
                onCreateSpace={() => console.log("create space")}
                totalUnreadBySpace={{ s2: 30, s3: 8 }}
                newUnreadBySpace={{ s2: 3 }}
            />
        </div>
    );
}

export const SpaceFlyoutOpen: StoryObj = {
    name: "Space 弹层（真实组件）",
    render: () => <SpaceOpen />,
};

export const SpaceUnreadBadgeAnchors: StoryObj = {
    name: "Space unread badges — collapsed and expanded",
    render: () => (
        <div style={{ display: "flex", gap: "var(--wk-sp-4)", alignItems: "flex-start" }}>
            {[false, true].map((expanded) => (
                <div key={String(expanded)} className={expanded ? "wk-layout-tab-expanded" : undefined} style={expanded ? { width: NAV_RAIL_EXPANDED_WIDTH } : undefined}>
                    {[0, 1, 12, 100].map((count) => (
                        <div key={count} className="wk-navrail" data-badge-count={count} style={{ height: "auto" }}>
                            <div className="wk-navrail__bottom">
                                <NavSpaceSwitcher
                                    spaces={count === 0 || count === 100 ? mockSpaces.map(space => space.space_id === "s1" ? { ...space, name: "A very long Space name for badge overflow checks" } : space) : mockSpaces}
                                    currentSpaceId="s1"
                                    onSpaceSelect={() => undefined}
                                    newUnreadBySpace={{ s2: count }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    ),
    play: async ({ canvasElement }) => {
        for (const rail of canvasElement.querySelectorAll<HTMLElement>("[data-badge-count]")) {
            const button = rail.querySelector<HTMLButtonElement>(".wk-navrail__space-icon-btn")!;
            const icon = button.querySelector<SVGElement>("svg")!;
            const iconBox = icon.getBoundingClientRect();
            const anchorBox = icon.parentElement!.getBoundingClientRect();
            expect(anchorBox.width).toBe(20);
            expect(anchorBox.height).toBe(20);
            expect(getComputedStyle(icon).color).toBe(getComputedStyle(button).color);

            const badge = button.querySelector<HTMLElement>(".wk-navrail__space-unread-badge");
            const count = Number(rail.dataset.badgeCount);
            const label = button.querySelector<HTMLElement>(".wk-navrail__item-label")!;
            expect(button.title).toBe(label.textContent);
            if (count === 0 || count === 100) {
                expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
                expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
                expect(getComputedStyle(label).display).toBe("block");
            }
            if (count === 0) {
                expect(badge).toBeNull();
                continue;
            }
            expect(badge!.textContent).toBe(count > 99 ? "99+" : String(count));
            const badgeBox = badge!.getBoundingClientRect();
            expect(badgeBox.height).toBe(14);
            expect(getComputedStyle(badge!).fontSize).toBe("9px");
            if (rail.closest(".wk-layout-tab-expanded")) {
                const buttonBox = button.getBoundingClientRect();
                expect(badgeBox.right).toBeCloseTo(buttonBox.right - 12, 1);
                expect(badgeBox.y + badgeBox.height / 2).toBeCloseTo(buttonBox.y + buttonBox.height / 2, 1);
                expect(label.getBoundingClientRect().right).toBeLessThan(badgeBox.left);
            } else {
                expect(badgeBox.x + badgeBox.width / 2).toBeCloseTo(iconBox.right, 1);
                expect(badgeBox.y + badgeBox.height / 2).toBeCloseTo(iconBox.top, 1);
            }
            expect(badge!.scrollWidth).toBeLessThanOrEqual(badge!.clientWidth);
        }
    },
};

function FlyoutComparison() {
    const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);
    return (
        <div style={{ display: "flex", gap: 260, alignItems: "flex-end", height: "100vh", padding: "0 0 80px 24px" }}>
            <BottomLanguageOpen />
            <div className="wk-navrail" style={{ height: 220, justifyContent: "flex-end" }}>
                <div className="wk-navrail__settings-wrap">
                    <button
                        ref={settingsTriggerRef}
                        type="button"
                        className="wk-navrail__item"
                        aria-label="设置"
                        aria-haspopup="menu"
                        aria-expanded
                    >
                        <Icon label="⚙️" />
                    </button>
                </div>
            </div>
            <NavSettingsPanel
                {...defaultArgs}
                settingSelected
                onToggleSetting={() => console.log("settings toggled")}
            />
            <SpaceOpen />
        </div>
    );
}

export const FlyoutComparisonOpen: StoryObj = {
    name: "语言 / 设置 / Space 弹层对照",
    render: () => <FlyoutComparison />,
};
