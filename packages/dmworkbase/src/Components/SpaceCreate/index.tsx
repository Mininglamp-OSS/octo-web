import React, { Component } from "react";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKInput from "../WKInput";
import { SpaceService } from "../../Service/SpaceService";
import WKButton from "../WKButton";
import InputEdit from "../InputEdit";
import "./index.css";

export interface SpaceCreateProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: (spaceId: string) => void;
}

interface SpaceCreateState {
    name: string;
    description: string;
    loading: boolean;
    inviteUrl: string;
}

export default class SpaceCreate extends Component<SpaceCreateProps, SpaceCreateState> {
    constructor(props: SpaceCreateProps) {
        super(props);
        this.state = {
            name: "",
            description: "",
            loading: false,
            inviteUrl: "",
        };
    }

    handleCreate = async () => {
        const { name, description } = this.state;
        if (!name.trim()) {
            Toast.warning("请输入 Space 名称");
            return;
        }
        this.setState({ loading: true });
        try {
            const resp = await SpaceService.shared.createSpace(name.trim(), description.trim());
            const invite = await SpaceService.shared.createInvite(resp.space_id);
            this.setState({ name: "", description: "", inviteUrl: invite.invite_url, loading: false });
            Toast.success("Space 创建成功");
            this.props.onSuccess(resp.space_id);
        } catch {
            Toast.error("创建失败，请重试");
            this.setState({ loading: false });
        }
    };

    handleCopyInvite = () => {
        navigator.clipboard.writeText(this.state.inviteUrl).then(() => {
            Toast.success("邀请链接已复制");
        });
    };

    handleClose = () => {
        this.setState({ name: "", description: "", inviteUrl: "", loading: false });
        this.props.onClose();
    };

    render() {
        const { visible } = this.props;
        const { name, description, loading, inviteUrl } = this.state;

        return (
            <WKModal
                title={inviteUrl ? "邀请成员" : "创建 Space"}
                visible={visible}
                onCancel={this.handleClose}
            >
                {inviteUrl ? (
                    <div className="wk-spacecreate-invite">
                        <p className="wk-spacecreate-invite-tip">Space 创建成功！分享以下链接邀请成员加入：</p>
                        <div className="wk-spacecreate-invite-link">
                            <WKInput value={inviteUrl} readOnly />
                            <WKButton variant="secondary" onClick={this.handleCopyInvite}>复制链接</WKButton>
                        </div>
                    </div>
                ) : (
                    <div className="wk-spacecreate-form">
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">名称</label>
                            <WKInput
                                placeholder="输入 Space 名称"
                                value={name}
                                onChange={(v) => this.setState({ name: v })}
                                maxLength={32}
                                onEnterPress={this.handleCreate}
                                autoFocus
                            />
                        </div>
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">描述</label>
                            <InputEdit
                                key={visible ? "open" : "closed"}
                                defaultValue={description}
                                placeholder="输入 Space 描述（可选）"
                                maxCount={200}
                                onChange={(v) => this.setState({ description: v })}
                            />
                        </div>
                        <div className="wk-spacecreate-actions">
                            <WKButton variant="secondary" onClick={this.handleClose}>取消</WKButton>
                            <WKButton variant="primary" loading={loading} onClick={this.handleCreate}>
                                创建
                            </WKButton>
                        </div>
                    </div>
                )}
            </WKModal>
        );
    }
}
