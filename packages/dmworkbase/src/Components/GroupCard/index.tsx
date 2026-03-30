import React, { Component } from "react";
import { Modal, Button, Spin } from "@douyinfe/semi-ui";
import { Channel, ChannelTypeGroup, WKSDK } from "wukongimjssdk";
import WKAvatar from "../WKAvatar";
import "./index.css";

interface GroupCardProps {
    groupNo: string;
    name?: string;
    memberCount?: number;
    visible: boolean;
    onClose: () => void;
    onEnterChat: (channel: Channel) => void;
}

interface GroupCardState {
    loading: boolean;
    name: string;
    memberCount: number;
}

export default class GroupCard extends Component<GroupCardProps, GroupCardState> {
    state: GroupCardState = {
        loading: true,
        name: "",
        memberCount: 0,
    };

    componentDidMount() {
        if (this.props.groupNo) this.loadGroupInfo();
    }

    componentDidUpdate(prevProps: GroupCardProps) {
        if (prevProps.groupNo !== this.props.groupNo && this.props.groupNo) {
            this.loadGroupInfo();
        }
    }

    loadGroupInfo = async () => {
        const { groupNo, name: propName, memberCount: propMemberCount } = this.props;
        if (!groupNo) return;

        this.setState({ loading: true });
        try {
            const channelInfo = await WKSDK.shared().channelManager.fetchChannelInfo(
                new Channel(groupNo, ChannelTypeGroup)
            );
            this.setState({
                loading: false,
                name: channelInfo?.title || propName || groupNo,
                memberCount: channelInfo?.orgData?.member_count || propMemberCount || 0,
            });
        } catch {
            this.setState({ loading: false, name: propName || groupNo, memberCount: propMemberCount || 0 });
        }
    };

    handleEnterChat = () => {
        const { groupNo, onEnterChat, onClose } = this.props;
        onEnterChat(new Channel(groupNo, ChannelTypeGroup));
        onClose();
    };

    render() {
        const { visible, onClose, groupNo } = this.props;
        const { loading, name, memberCount } = this.state;

        return (
            <Modal
                title={null}
                visible={visible}
                onCancel={onClose}
                footer={null}
                width={380}
                className="wk-group-card-modal"
            >
                {loading ? (
                    <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <div className="wk-group-card-content">
                        <div className="wk-group-card-header">
                            <WKAvatar channel={new Channel(groupNo, ChannelTypeGroup)} />
                            <div className="wk-group-card-name">
                                {name} <span className="wk-group-card-tag">{"\u7FA4"}</span>
                            </div>
                            {memberCount > 0 && (
                                <div className="wk-group-card-meta">{memberCount} 位成员</div>
                            )}
                        </div>
                        <Button
                            theme="solid"
                            type="primary"
                            block
                            onClick={this.handleEnterChat}
                            style={{ marginTop: 8 }}
                        >
                            进入群聊
                        </Button>
                    </div>
                )}
            </Modal>
        );
    }
}
