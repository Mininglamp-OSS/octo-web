import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import WKApp from "../../App";
import {
    IncomingWebhook,
    IncomingWebhookCreateResp,
} from "../../Service/IncomingWebhook";
import ChannelWebhookPanel from "./index";
import WebhookEditModal from "./WebhookEditModal";
import WebhookUrlModal from "./WebhookUrlModal";
import MessageRow from "../../ui/message/MessageRow";
import { INCOMING_WEBHOOK_DEFAULT_AVATAR } from "../../Service/IncomingWebhook";

/**
 * Storybook 专用 mock：把 channelDataSource 的 webhook 方法替换为内存实现。
 * 仅 story 环境生效，不影响生产代码。
 */
const now = Math.floor(Date.now() / 1000);

const mockList: IncomingWebhook[] = [
    {
        webhook_id: "iwh_becd9cdbeda34190a91339757d64c184",
        group_no: "g1",
        name: "ci-alerts",
        avatar: "",
        creator_uid: "uid_admin",
        status: 1,
        last_used_at: now - 3600,
        call_count: 128,
        created_at: now - 86400 * 30,
    },
    {
        webhook_id: "iwh_7788",
        group_no: "g1",
        name: "Webhook-deploy-notify",
        avatar: "",
        creator_uid: "uid_member",
        status: 1,
        last_used_at: 0,
        call_count: 0,
        created_at: now - 86400 * 3,
    },
    {
        webhook_id: "iwh_9900",
        group_no: "g1",
        name: "Webhook-旧告警通道",
        avatar: "",
        creator_uid: "uid_other",
        status: 0,
        last_used_at: now - 86400 * 14,
        call_count: 56,
        created_at: now - 86400 * 90,
    },
];

const mockCreateResp: IncomingWebhookCreateResp = {
    ...mockList[0],
    token: "sample-token-storybook-only",
    url: "/v1/incoming-webhooks/iwh_becd9cdbeda34190a91339757d64c184/sample-token-storybook-only",
    urls: {
        native: "/v1/incoming-webhooks/iwh_becd9cdbeda34190a91339757d64c184/sample-token-storybook-only",
        github: "/v1/incoming-webhooks/iwh_becd9cdbeda34190a91339757d64c184/sample-token-storybook-only/github",
        wecom: "/v1/incoming-webhooks/iwh_becd9cdbeda34190a91339757d64c184/sample-token-storybook-only/wecom",
    },
};

function installMock(list: IncomingWebhook[] = mockList) {
    WKApp.loginInfo.uid = "uid_admin";
    WKApp.apiClient.config.apiURL = "/api/v1/";
    const ds = (WKApp.dataSource.channelDataSource ||
        {}) as Record<string, unknown>;
    ds.incomingWebhooks = async () => list;
    ds.createIncomingWebhook = async () => mockCreateResp;
    ds.updateIncomingWebhook = async () => list[0];
    ds.deleteIncomingWebhook = async () => undefined;
    ds.regenerateIncomingWebhook = async () => mockCreateResp;
    ds.testIncomingWebhook = async () => undefined;
    WKApp.dataSource.channelDataSource = ds as never;
}

const channel = new Channel("g1", ChannelTypeGroup);

const meta: Meta = {
    title: "ChannelSetting/ChannelWebhook",
    parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

/** 管理员视角：可管理全部 webhook（启用/禁用/编辑/重置/测试/删除） */
export const ListAdmin: Story = {
    name: "列表（管理员视角）",
    render: () => {
        installMock();
        return (
            <div style={{ width: 360, height: 640, border: "1px solid #eee", margin: "0 auto" }}>
                <ChannelWebhookPanel channel={channel} isManager />
            </div>
        );
    },
};

/** 普通成员视角：只能管理自己创建的（uid_member），其余只读 */
export const ListMember: Story = {
    name: "列表（成员视角）",
    render: () => {
        installMock();
        WKApp.loginInfo.uid = "uid_member";
        return (
            <div style={{ width: 360, height: 640, border: "1px solid #eee", margin: "0 auto" }}>
                <ChannelWebhookPanel channel={channel} isManager={false} />
            </div>
        );
    },
};

export const EmptyState: Story = {
    name: "空态",
    render: () => {
        installMock([]);
        return (
            <div style={{ width: 360, height: 640, border: "1px solid #eee", margin: "0 auto" }}>
                <ChannelWebhookPanel channel={channel} isManager />
            </div>
        );
    },
};

export const CreateModalAdmin: Story = {
    name: "新建弹窗（管理员）",
    render: () => {
        installMock();
        return (
            <WebhookEditModal
                channel={channel}
                isManager
                onClose={() => undefined}
                onSaved={() => undefined}
            />
        );
    },
};

export const CreateModalMember: Story = {
    name: "新建弹窗（成员）",
    render: () => {
        installMock();
        return (
            <WebhookEditModal
                channel={channel}
                isManager={false}
                onClose={() => undefined}
                onSaved={() => undefined}
            />
        );
    },
};

/** 创建/重置成功后的一次性推送地址弹窗（token 仅此一次展示） */
export const UrlModal: Story = {
    name: "一次性推送地址弹窗",
    render: () => {
        installMock();
        return <WebhookUrlModal resp={mockCreateResp} onClose={() => undefined} />;
    },
};

/** 聊天里的 webhook 消息：发送者名/头像读 payload from 元信息，名称旁带 Webhook 标识 */
export const WebhookMessage: Story = {
    name: "Webhook 消息气泡",
    render: () => (
        <div style={{ width: 480, padding: 16, margin: "0 auto", background: "#fff" }}>
            <MessageRow
                isSend={false}
                isContinue={false}
                isSelected={false}
                showAvatar
                avatarUrl={INCOMING_WEBHOOK_DEFAULT_AVATAR}
                senderName="ci-alerts"
                isWebhook
                timestamp="10:24"
            >
                <div
                    style={{
                        background: "rgba(28,28,35,0.05)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        display: "inline-block",
                    }}
                >
                    构建成功 ✅ main #2381 (2m13s)
                </div>
            </MessageRow>
        </div>
    ),
};
