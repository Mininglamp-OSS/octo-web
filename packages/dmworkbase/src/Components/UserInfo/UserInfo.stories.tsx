import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconEdit } from "@douyinfe/semi-icons";
import React from "react";
import WKButton from "../WKButton";
import UserInfoFooter from "./UserInfoFooter";
import UserInfoHeader from "./UserInfoHeader";
import type { UserInfoMetaItem } from "./UserInfoMetaList";
import "./index.css";

interface UserInfoPreviewProps {
    name: string;
    avatarText: string;
    isBot?: boolean;
    isRealnameVerified?: boolean;
    metaItems?: UserInfoMetaItem[];
    remark?: string;
    footer: "message" | "addFriend" | "external" | "none";
}

function PreviewAvatar({ text }: { text: string }) {
    return <div className="wk-userinfo-story-avatar">{text}</div>
}

function UserInfoPreview({
    name,
    avatarText,
    isBot,
    isRealnameVerified,
    metaItems = [],
    remark,
    footer,
}: UserInfoPreviewProps) {
    const action = footer === "message"
        ? <WKButton type="button" variant="primary">发送消息</WKButton>
        : footer === "addFriend"
            ? <WKButton type="button" variant="secondary">添加好友</WKButton>
            : undefined;
    const hint = footer === "external" ? "外部成员仅可在群内交流" : undefined;

    return <div className={`wk-userinfo wk-userinfo-story ${footer !== "none" ? "wk-userinfo--with-footer" : ""}`}>
        <div className="wk-userinfo-content">
            <UserInfoHeader
                avatar={<PreviewAvatar text={avatarText} />}
                displayName={name}
                isBot={isBot}
                isRealnameVerified={isRealnameVerified}
                metaItems={metaItems}
            />
            <div className="wk-userinfo-remark-section">
                <div className="wk-userinfo-remark-row">
                    <div className="wk-userinfo-remark-main">
                        <div className="wk-userinfo-remark-label">备注</div>
                        <div className="wk-userinfo-remark-value">
                            {remark || <span className="wk-userinfo-remark-empty">未设置</span>}
                        </div>
                    </div>
                    <button type="button" className="wk-userinfo-remark-edit" aria-label="编辑备注">
                        <IconEdit />
                    </button>
                </div>
            </div>
            <div className="wk-userinfo-sections">
                <div className="wk-sections">
                    <div className="wk-section">
                        <div className="wk-channelsetting-section-rows">
                            <div className="wk-section-row">
                                <div className="wk-list-item wk-list-item-static">
                                    <div className="wk-list-item-title">来源</div>
                                    <div className="wk-list-item-subtitle">通过群聊添加</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <UserInfoFooter action={action} hint={hint} />
    </div>
}

const baseMeta: UserInfoMetaItem[] = [
    { label: "昵称", value: "Alice" },
    { label: "Octo号", value: "octo_1001" },
];

const meta: Meta<typeof UserInfoPreview> = {
    title: "Business/UserInfo",
    component: UserInfoPreview,
    parameters: {
        docs: {
            description: {
                component: "UserInfo 展示结构试点，覆盖资料头部、资料项和底部操作区。业务 VM 与好友申请流程不在 Story 内挂载。",
            },
        },
    },
    args: {
        name: "Alice Chen",
        avatarText: "A",
        isBot: false,
        isRealnameVerified: true,
        metaItems: baseMeta,
        remark: "Alice",
        footer: "message",
    },
    argTypes: {
        footer: {
            control: "radio",
            options: ["message", "addFriend", "external", "none"],
        },
    },
    decorators: [
        (Story) => <div className="wk-userinfo-story-frame">
            <Story />
        </div>,
    ],
};

export default meta;
type Story = StoryObj<typeof UserInfoPreview>;

export const Friend: Story = {
    name: "好友",
};

export const Stranger: Story = {
    name: "陌生人",
    args: {
        name: "Bob Lee",
        avatarText: "B",
        isRealnameVerified: false,
        remark: "",
        metaItems: [
            { label: "群昵称", value: "产品讨论组里的 Bob" },
            { label: "Octo号", value: "octo_2048" },
        ],
        footer: "addFriend",
    },
};

export const Bot: Story = {
    name: "Bot",
    args: {
        name: "BotFather",
        avatarText: "B",
        isBot: true,
        isRealnameVerified: false,
        remark: "Bot 管家",
        metaItems: [
            { label: "昵称", value: "BotFather" },
            { label: "Octo号", value: "bot_father" },
        ],
        footer: "addFriend",
    },
};

export const ExternalMember: Story = {
    name: "外部成员",
    args: {
        name: "External User",
        avatarText: "E",
        isRealnameVerified: true,
        remark: "外部协作人",
        metaItems: [
            { label: "昵称", value: "External User" },
            { label: "群昵称", value: "外部协作成员" },
        ],
        footer: "external",
    },
};

export const LongText: Story = {
    name: "长文本",
    args: {
        name: "这是一个非常长的用户展示名称用于验证弹窗头部是否会换行并保持底部操作区稳定",
        avatarText: "长",
        isRealnameVerified: true,
        remark: "这是一个非常长的备注名用于验证资料卡内联备注编辑布局是否稳定",
        metaItems: [
            { label: "昵称", value: "一个非常非常长的昵称内容用于验证资料行换行和宽度处理" },
            { label: "群昵称", value: "群内备注同样可能非常长，需要保持不挤压头像和按钮" },
            { label: "Octo号", value: "octo_long_text_user_0000000000000001" },
        ],
        footer: "message",
    },
};
