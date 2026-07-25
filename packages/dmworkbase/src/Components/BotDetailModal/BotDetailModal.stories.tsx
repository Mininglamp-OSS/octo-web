import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAlertCircle, IconChevronRight, IconTickCircle } from "@douyinfe/semi-icons";
import React from "react";
import AiBadge from "../AiBadge";
import WKButton from "../WKButton";
import { ProfileDetailFooter } from "../../ui/profileDetail/ProfileDetailShell";
import "./index.css";

interface BotDetailPreviewProps {
    name: string;
    username: string;
    remark?: string;
    description: string;
    creatorName?: string;
    isOwner?: boolean;
    isFriend?: boolean;
    reported?: boolean | null;
    longCommands?: boolean;
}

function PreviewAvatar() {
    return <div className="wk-bot-detail-story-avatar">AI</div>
}

function ReportChip({ reported }: { reported?: boolean | null }) {
    if (reported == null) return null;
    return <div className={`wk-bot-detail-octopush-chip ${reported ? "wk-bot-detail-octopush-chip--reported" : "wk-bot-detail-octopush-chip--unmanaged"}`}>
        <span className="wk-bot-detail-octopush-status">
            <span className="wk-bot-detail-octopush-chip-icon">{reported ? <IconTickCircle /> : <IconAlertCircle />}</span>
            <span className="wk-bot-detail-octopush-chip-text">{reported ? "已上报 Agent 信息" : "未上报 Agent 信息"}</span>
        </span>
    </div>
}

function BotDetailPreview({
    name,
    username,
    remark,
    description,
    creatorName,
    isOwner,
    isFriend,
    reported,
    longCommands,
}: BotDetailPreviewProps) {
    const displayName = remark || name;

    return <div className="wk-bot-detail-modal wk-bot-detail-story">
        <div className="wk-bot-detail-content">
            <div className="wk-bot-detail-route-header">
                <button type="button" className="wk-bot-detail-route-close" aria-label="关闭">
                    <span className="wk-bot-detail-route-close-icon" aria-hidden="true" />
                </button>
            </div>
            <div className="wk-bot-detail-scroll">
                <div className="wk-bot-detail-header">
                    <div className="wk-bot-detail-avatar">
                        <PreviewAvatar />
                    </div>
                    <div className="wk-bot-detail-heading">
                        <div className="wk-bot-detail-name">
                            <span className="wk-bot-detail-name-text">{displayName}</span>
                            <AiBadge />
                        </div>
                        <div className="wk-bot-detail-id">@{username}</div>
                        {isOwner && <ReportChip reported={reported} />}
                    </div>
                </div>

                <div className="wk-bot-detail-section">
                    <div className="wk-bot-detail-row wk-bot-detail-row--editable">
                        <div className="wk-bot-detail-row-main">
                            <div className="wk-bot-detail-label">备注</div>
                            <div className="wk-bot-detail-value">
                                {remark || <span className="wk-bot-detail-empty">未设置</span>}
                            </div>
                        </div>
                    </div>
                    {remark && <div className="wk-bot-detail-row">
                        <div className="wk-bot-detail-label">昵称</div>
                        <div className="wk-bot-detail-value wk-bot-detail-value--right">{name}</div>
                    </div>}
                </div>

                <div className="wk-bot-detail-section">
                    <div className="wk-bot-detail-description">
                        <div className="wk-bot-detail-field-header">
                            <div className="wk-bot-detail-label">简介</div>
                        </div>
                        <div className="wk-bot-detail-description-text">{description}</div>
                    </div>
                </div>

                {(creatorName || longCommands) && <div className="wk-bot-detail-section">
                    {creatorName && <div className="wk-bot-detail-row">
                        <div className="wk-bot-detail-label">创建者</div>
                        <div className="wk-bot-detail-value wk-bot-detail-value--right">{creatorName}</div>
                    </div>}
                    {longCommands && <div className="wk-bot-detail-command-block">
                        <div className="wk-bot-detail-label">指令</div>
                        <div className="wk-bot-detail-command-list">
                            <div className="wk-bot-detail-cmd">
                                <span className="wk-bot-detail-cmd-name">/help</span>
                                <span className="wk-bot-detail-cmd-desc">查看 Bot 能力说明</span>
                            </div>
                            <div className="wk-bot-detail-cmd">
                                <span className="wk-bot-detail-cmd-name">/summarize</span>
                                <span className="wk-bot-detail-cmd-desc">总结当前上下文中的重点信息</span>
                            </div>
                        </div>
                    </div>}
                </div>}

                {isOwner && <div className="wk-bot-detail-section">
                    <button type="button" className="wk-bot-detail-nav-row">
                        <span>Bot 管理</span>
                        <IconChevronRight className="wk-bot-detail-nav-chevron" />
                    </button>
                    {reported !== null && <button
                        type="button"
                        className={`wk-bot-detail-nav-row${!reported ? " wk-bot-detail-nav-row--disabled" : ""}`}
                        disabled={!reported}
                    >
                        <span className="wk-bot-detail-nav-main">
                            <span className="wk-bot-detail-claw-action-icon" aria-hidden="true">🦞</span>
                            <span>查看龙虾信息</span>
                        </span>
                        {reported && <IconChevronRight className="wk-bot-detail-nav-chevron" />}
                    </button>}
                </div>}
            </div>

            <ProfileDetailFooter
                className="wk-bot-detail-footer"
                actionClassName="wk-bot-detail-actions"
                action={
                    <WKButton type="button" variant="primary">
                        {isFriend ? "发送消息" : "添加好友"}
                    </WKButton>
                }
            />
        </div>
    </div>
}

const meta: Meta<typeof BotDetailPreview> = {
    title: "Business/BotDetail",
    component: BotDetailPreview,
    parameters: {
        docs: {
            description: {
                component: "BotDetailModal 视觉试点，覆盖 Bot 资料头部、信息分组、管理入口和底部操作区。业务请求、头像上传和管理下钻不在 Story 内挂载。",
            },
        },
    },
    args: {
        name: "BotFather",
        username: "botfather",
        remark: "我的 Bot 管家",
        description: "用于创建、管理和配置团队内的 AI Bot。",
        creatorName: "Alice Chen",
        isOwner: true,
        isFriend: true,
        reported: true,
        longCommands: true,
    },
    decorators: [
        (Story) => <div className="wk-bot-detail-story-frame">
            <Story />
        </div>,
    ],
};

export default meta;
type Story = StoryObj<typeof BotDetailPreview>;

export const OwnerFriend: Story = {
    name: "Owner / 已添加",
};

export const Stranger: Story = {
    name: "陌生 Bot",
    args: {
        remark: "",
        creatorName: "",
        isOwner: false,
        isFriend: false,
        reported: null,
        longCommands: false,
    },
};

export const OwnerNotReported: Story = {
    name: "Owner / 未接入",
    args: {
        reported: false,
    },
};

export const LongText: Story = {
    name: "长文本",
    args: {
        name: "这是一个非常长的 Bot 名称用于验证标题换行和布局稳定性",
        username: "very_long_bot_username_for_layout_check",
        remark: "团队知识库自动化助手的超长备注名称",
        description: "这是一段非常长的 Bot 简介，用于验证弹窗内容在较多文本下的滚动表现、分组卡片高度、底部操作区稳定性，以及长单词 verylongwordwithoutbreakverylongwordwithoutbreak 的换行表现。",
        creatorName: "一个非常长的创建者名称",
        longCommands: true,
    },
};
