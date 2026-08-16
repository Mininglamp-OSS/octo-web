import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import NavRail from "./index";
import type { NavRailProps } from "./index";
import NavBottom from "./NavBottom";
import NavSpaceSwitcher from "./NavSpaceSwitcher";
import NavSettingsPanel from "./NavSettingsPanel";
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
    showNewVersion: false,
    showAppVersion: false,
    showAppUpdate: false,
    appUpdateProgress: 0,
    showAppUpdateOperation: false,
    spaces: mockSpaces,
    currentSpaceId: "s1",
    onMenuClick: (menus) => console.log("nav menu clicked:", menus.id),
    onToggleSetting: () => console.log("settings toggled"),
    onSetShowNewVersion: (v) => console.log("show new version:", v),
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
            />
        </div>
    );
}

export const SpaceFlyoutOpen: StoryObj = {
    name: "Space 弹层（真实组件）",
    render: () => <SpaceOpen />,
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
                triggerRef={settingsTriggerRef}
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
