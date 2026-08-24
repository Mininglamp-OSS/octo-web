import { Button, Checkbox, Input } from "@octo/ui";
import React, { Component } from "react";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { SpaceService } from "../../Service/SpaceService";
import { extractErrorMsg } from "../../Service/APIClient";
import { I18nContext } from "../../i18n";
import "./index.css";

export interface SpaceCreateProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: (spaceId: string) => void;
}

interface SpaceCreateState {
    name: string;
    description: string;
    joinMode: number;  // 0=直接加入，1=需要审批
    loading: boolean;
    inviteUrl: string;
}

export default class SpaceCreate extends Component<SpaceCreateProps, SpaceCreateState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    constructor(props: SpaceCreateProps) {
        super(props);
        this.state = {
            name: "",
            description: "",
            joinMode: 0,
            loading: false,
            inviteUrl: "",
        };
    }

    handleCreate = async () => {
        const { name, description, joinMode } = this.state;
        const { t } = this.context;
        if (!name.trim()) {
            Toast.warning(t("base.spaceCreate.nameRequired"));
            return;
        }
        this.setState({ loading: true });
        try {
            const resp = await SpaceService.shared.createSpace(name.trim(), description.trim(), joinMode);
            const invite = await SpaceService.shared.createInvite(resp.space_id);
            this.setState({ name: "", description: "", joinMode: 0, inviteUrl: invite.invite_url, loading: false });
            Toast.success(t("base.spaceCreate.success"));
            this.props.onSuccess(resp.space_id);
        } catch (err: unknown) {
            Toast.error(extractErrorMsg(err) || t("base.spaceCreate.failed"));
            this.setState({ loading: false });
        }
    };

    handleCopyInvite = () => {
        navigator.clipboard.writeText(this.state.inviteUrl).then(() => {
            Toast.success(this.context.t("base.spaceCreate.inviteCopied"));
        });
    };

    handleClose = () => {
        this.setState({ name: "", description: "", joinMode: 0, inviteUrl: "", loading: false });
        this.props.onClose();
    };

    render() {
        const { visible } = this.props;
        const { name, description, joinMode, loading, inviteUrl } = this.state;
        const { t } = this.context;

        return (
            <WKModal
                title={inviteUrl ? t("base.spaceCreate.inviteMembers") : t("base.spaceCreate.createSpace")}
                visible={visible}
                onCancel={this.handleClose}
            >
                {inviteUrl ? (
                    <div className="wk-spacecreate-invite">
                        <p className="wk-spacecreate-invite-tip">
                            {t("base.spaceCreate.successInviteTip")}
                        </p>
                        <div className="wk-spacecreate-invite-link">
                            <Input value={inviteUrl} readOnly />
                            <Button variant="secondary" onClick={this.handleCopyInvite}>
                                {t("base.spaceCreate.copyLink")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="wk-spacecreate-form">
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">{t("base.spaceCreate.name")}</label>
                            <Input
                                placeholder={t("base.spaceCreate.namePlaceholder")}
                                value={name}
                                onChange={(v) => this.setState({ name: v })}
                                maxLength={32}
                                onEnterPress={this.handleCreate}
                                autoFocus
                            />
                        </div>
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">{t("base.spaceCreate.description")}</label>
                            <Input.TextArea
                                key={visible ? "open" : "closed"}
                                value={description}
                                placeholder={t("base.spaceCreate.descriptionPlaceholder")}
                                maxCount={200}
                                onChange={(v) => this.setState({ description: v })}
                            />
                        </div>
                        <div className="wk-spacecreate-field">
                            <Checkbox
                                checked={joinMode === 1}
                                onCheckedChange={(checked) => this.setState({ joinMode: checked ? 1 : 0 })}
                            >
                                {t("base.spaceCreate.approvalRequired")}
                            </Checkbox>
                        </div>
                        <div className="wk-spacecreate-actions">
                            <Button variant="secondary" onClick={this.handleClose}>{t("base.common.cancel")}</Button>
                            <Button variant="solid" loading={loading} onClick={this.handleCreate}>
                                {t("base.spaceCreate.create")}
                            </Button>
                        </div>
                    </div>
                )}
            </WKModal>
        );
    }
}
