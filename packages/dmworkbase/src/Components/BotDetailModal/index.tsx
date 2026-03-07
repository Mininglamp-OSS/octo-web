import React, { Component } from "react";
import { Modal, Button, Spin } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import { WKApp } from "../../App";
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
    description: string;
    creatorName: string;
    botCommands: string;
}

export default class BotDetailModal extends Component<BotDetailModalProps, BotDetailModalState> {
    state: BotDetailModalState = {
        loading: true,
        name: "",
        description: "",
        creatorName: "",
        botCommands: "",
    };

    componentDidMount() {
        this.loadBotInfo();
    }

    componentDidUpdate(prevProps: BotDetailModalProps) {
        if (prevProps.uid !== this.props.uid && this.props.uid) {
            this.loadBotInfo();
        }
    }

    loadBotInfo = async () => {
        const { uid } = this.props;
        if (!uid) return;

        this.setState({ loading: true });
        try {
            const channelInfo = await WKSDK.shared().channelManager.fetchChannelInfo(
                new Channel(uid, ChannelTypePerson)
            );
            this.setState({
                loading: false,
                name: channelInfo?.title || uid,
                description: channelInfo?.orgData?.bot_description || "暂无简介",
                creatorName: channelInfo?.orgData?.bot_creator_name || "",
                botCommands: channelInfo?.orgData?.bot_commands || "",
            });
        } catch {
            this.setState({ loading: false, name: uid, description: "暂无简介" });
        }
    };

    handleChat = () => {
        const { uid, onChat, onClose } = this.props;
        const spaceId = WKApp.shared.currentSpaceId;
        const channelId = spaceId ? `s${spaceId}_${uid}` : uid;
        onChat(new Channel(channelId, ChannelTypePerson));
        onClose();
    };

    render() {
        const { visible, onClose, uid } = this.props;
        const { loading, name, description, creatorName, botCommands } = this.state;

        let commands: { cmd: string; remark: string }[] = [];
        try {
            if (botCommands) commands = JSON.parse(botCommands);
        } catch {}

        return (
            <Modal
                title={null}
                visible={visible}
                onCancel={onClose}
                footer={null}
                width={380}
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
                                {name} <AiBadge />
                            </div>
                            {creatorName && (
                                <div className="wk-bot-detail-creator">
                                    由 {creatorName} 创建
                                </div>
                            )}
                        </div>
                        <div className="wk-bot-detail-desc">
                            <div className="wk-bot-detail-label">简介</div>
                            <div>{description}</div>
                        </div>
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
                        <Button
                            theme="solid"
                            type="primary"
                            block
                            onClick={this.handleChat}
                            style={{ marginTop: 16 }}
                        >
                            发消息
                        </Button>
                    </div>
                )}
            </Modal>
        );
    }
}
