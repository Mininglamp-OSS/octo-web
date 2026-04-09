import React, { Component } from "react";
import { Button, Spin, Toast, Input } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import WKApp from "../../App";
import WKAvatar from "../WKAvatar";
import AiBadge from "../AiBadge";
import "./index.css";

interface BotDetailModalProps {
    uid: string;
    visible: boolean;
    onClose: () => void;
    onChat: (channel: Channel) => void;
}

interface BotDetailModalState {
    loading: boolean;
    name: string;
    username: string;
    description: string;
    creatorName: string;
    botCommands: string;
    isFriend: boolean;
    applying: boolean;
    showApplyInput: boolean;
    applyRemark: string;
}

export default class BotDetailModal extends Component<BotDetailModalProps, BotDetailModalState> {
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    state: BotDetailModalState = {
        loading: true,
        name: "",
        username: "",
        description: "",
        creatorName: "",
        botCommands: "",
        isFriend: false,
        applying: false,
        showApplyInput: false,
        applyRemark: "",
    };

    componentDidMount() {
        if (this.props.uid) this.loadBotInfo();
    }

    componentDidUpdate(prevProps: BotDetailModalProps) {
        if (prevProps.uid !== this.props.uid && this.props.uid) {
            this.loadBotInfo();
        }
    }

    componentWillUnmount() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    loadBotInfo = async () => {
        const { uid } = this.props;
        if (!uid) return;

        this.setState({ loading: true });
        try {
            // 用 user detail API 获取完整信息（包含 follow）
            const data = await WKApp.apiClient.get(`users/${uid}`);
            this.setState({
                loading: false,
                name: data.name || uid,
                username: data.username || uid,
                description: data.bot_description || "暂无简介",
                creatorName: data.bot_creator_name || "",
                botCommands: data.bot_commands || "",
                isFriend: data.follow === 1,
            });
        } catch {
            // fallback to channel info
            try {
                const channelInfo = await WKSDK.shared().channelManager.fetchChannelInfo(
                    new Channel(uid, ChannelTypePerson)
                );
                this.setState({
                    loading: false,
                    name: channelInfo?.title || uid,
                    username: uid,
                    description: channelInfo?.orgData?.bot_description || "暂无简介",
                    creatorName: channelInfo?.orgData?.bot_creator_name || "",
                    botCommands: channelInfo?.orgData?.bot_commands || "",
                    isFriend: channelInfo?.orgData?.follow === 1,
                });
            } catch {
                this.setState({ loading: false, name: uid });
            }
        }
    };

    handleChat = () => {
        const { uid, onChat, onClose } = this.props;
        // WuKongIM DM 只认裸 uid
        onChat(new Channel(uid, ChannelTypePerson));
        onClose();
    };

    handleShowApply = () => {
        const { name } = this.state;
        this.setState({
            showApplyInput: true,
            applyRemark: `我想使用${name.replace(/\*\*/g, '')}`,
        });
    };

    handleSubmitApply = async () => {
        const { uid } = this.props;
        const { applyRemark } = this.state;
        this.setState({ applying: true });
        try {
            const body: any = { to_uid: uid, remark: applyRemark };
            const spaceId = WKApp.shared.currentSpaceId;
            if (spaceId) {
                body.space_id = spaceId;
            }
            await WKApp.apiClient.post("friend/apply", body);
            Toast.success("好友申请已发送");
            this.setState({ showApplyInput: false });
            this.refreshTimer = setTimeout(() => this.loadBotInfo(), 500);
        } catch {
            Toast.error("申请失败");
        } finally {
            this.setState({ applying: false });
        }
    };

    render() {
        const { visible, onClose, uid } = this.props;
        const { loading, name, username, description, creatorName, botCommands, isFriend, applying, showApplyInput, applyRemark } = this.state;

        let commands: { cmd: string; remark: string }[] = [];
        try {
            if (botCommands) commands = JSON.parse(botCommands);
        } catch {}

        return (
            <WKModal
                title={null}
                visible={visible}
                onCancel={onClose}
                className="wk-bot-detail-modal"
            >
                {loading ? (
                    <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <div className="wk-bot-detail-content">
                        <div className="wk-bot-detail-header">
                            <WKAvatar channel={new Channel(uid, ChannelTypePerson)} size={64} />
                            <div className="wk-bot-detail-name">
                                {name.replace(/\*\*/g, '')} <AiBadge />
                            </div>
                            <div className="wk-bot-detail-id">@{username}</div>
                        </div>
                        <div className="wk-bot-detail-desc">
                            <div className="wk-bot-detail-label">简介</div>
                            <div>{description.replace(/\*\*/g, '')}</div>
                        </div>
                        {creatorName && (
                            <div className="wk-bot-detail-desc">
                                <div className="wk-bot-detail-label">创建者</div>
                                <div>{creatorName}</div>
                            </div>
                        )}
                        {commands.length > 0 && (
                            <div className="wk-bot-detail-commands">
                                <div className="wk-bot-detail-label">命令</div>
                                {commands.map((cmd, i) => (
                                    <div key={i} className="wk-bot-detail-cmd">
                                        <span className="wk-bot-detail-cmd-name">{cmd.cmd}</span>
                                        <span className="wk-bot-detail-cmd-desc">{cmd.remark}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {isFriend ? (
                            <Button
                                theme="solid"
                                type="primary"
                                block
                                onClick={this.handleChat}
                                style={{ marginTop: 16 }}
                            >
                                发送消息
                            </Button>
                        ) : showApplyInput ? (
                            <div style={{ marginTop: 16 }}>
                                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>申请消息</div>
                                <Input
                                    value={applyRemark}
                                    onChange={(v) => this.setState({ applyRemark: v })}
                                    placeholder="请输入申请消息"
                                    style={{ marginBottom: 12 }}
                                />
                                <Button
                                    theme="solid"
                                    type="primary"
                                    block
                                    loading={applying}
                                    disabled={!applyRemark}
                                    onClick={this.handleSubmitApply}
                                >
                                    发送申请
                                </Button>
                            </div>
                        ) : (
                            <Button
                                theme="solid"
                                type="primary"
                                block
                                onClick={this.handleShowApply}
                                style={{ marginTop: 16 }}
                            >
                                添加好友
                            </Button>
                        )}
                    </div>
                )}
            </WKModal>
        );
    }
}
