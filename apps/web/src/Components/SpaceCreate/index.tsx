import React, { Component } from "react";
import { Input, Toast } from "@douyinfe/semi-ui";
import { I18nContext, SpaceService, WKModal, extractErrorMsg, t } from "@octo/base";
import VoiceInputButton, { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import "./index.css";

export interface SpaceCreateProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface SpaceCreateState {
    name: string;
    description: string;
    loading: boolean;
    inviteUrl: string;
}

export default class SpaceCreate extends Component<SpaceCreateProps, SpaceCreateState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private descriptionRef = React.createRef<HTMLTextAreaElement>();

    private handleVoiceTranscribed = (
        text: string,
        mode: ReplaceMode,
        savedRange?: SelectionRange
    ) => {
        if (mode === "all") {
            this.setState({ description: text.slice(0, 200) });
        } else if (mode === "selection" && savedRange) {
            this.setState((prev) => {
                const before = prev.description.slice(0, savedRange.from);
                const after = prev.description.slice(savedRange.to);
                const budget = Math.max(0, 200 - before.length - after.length);
                return { description: before + text.slice(0, budget) + after };
            });
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.description.length;
                const before = prev.description.slice(0, pos);
                const after = prev.description.slice(pos);
                const budget = Math.max(0, 200 - before.length - after.length);
                return { description: before + text.slice(0, budget) + after };
            });
        }
    };

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
            Toast.warning(t("app.spaceCreate.validation.nameRequired"));
            return;
        }
        this.setState({ loading: true });
        try {
            const resp = await SpaceService.shared.createSpace(name.trim(), description.trim());
            const invite = await SpaceService.shared.createInvite(resp.space_id);
            this.setState({ inviteUrl: invite.invite_url, loading: false });
            Toast.success(t("app.spaceCreate.createSuccess"));
            this.props.onSuccess();
        } catch (err: unknown) {
            Toast.error(extractErrorMsg(err) || t("app.spaceCreate.createFailedRetry"));
            this.setState({ loading: false });
        }
    };

    handleCopyInvite = () => {
        navigator.clipboard.writeText(this.state.inviteUrl).then(() => {
            Toast.success(t("app.spaceCreate.inviteCopied"));
        });
    };

    handleClose = () => {
        this.setState({ name: "", description: "", inviteUrl: "", loading: false });
        this.props.onClose();
    };

    render() {
        const { visible } = this.props;
        const { name, description, loading, inviteUrl } = this.state;
        const { t } = this.context;

        return (
            <WKModal
                title={inviteUrl ? t("app.spaceCreate.inviteMembersTitle") : t("app.spaceCreate.createTitle")}
                visible={visible}
                onCancel={this.handleClose}
            >
                {inviteUrl ? (
                    <div className="wk-spacecreate-invite">
                        <p className="wk-spacecreate-invite-tip">{t("app.spaceCreate.inviteTip")}</p>
                        <div className="wk-spacecreate-invite-link">
                            <Input value={inviteUrl} readOnly />
                            <button className="wk-spacecreate-btn" onClick={this.handleCopyInvite}>
                                {t("app.spaceCreate.copyLink")}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="wk-spacecreate-form">
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">{t("app.spaceCreate.nameLabel")}</label>
                            <Input
                                placeholder={t("app.spaceCreate.namePlaceholder")}
                                value={name}
                                onChange={(v) => this.setState({ name: v })}
                                maxLength={32}
                            />
                        </div>
                        <div className="wk-spacecreate-field">
                            <label className="wk-spacecreate-label">{t("app.spaceCreate.descriptionLabel")}</label>
                            <div style={{ position: "relative" }}>
                                <textarea
                                    ref={this.descriptionRef}
                                    className="wk-spacecreate-textarea"
                                    placeholder={t("app.spaceCreate.descriptionPlaceholder")}
                                    value={description}
                                    onChange={(e) => this.setState({ description: e.target.value.slice(0, 200) })}
                                    maxLength={200}
                                    rows={3}
                                />
                                <VoiceInputButton
                                    inputRef={this.descriptionRef}
                                    onTranscribed={this.handleVoiceTranscribed}
                                    getCurrentText={() => this.state.description}
                                    showModeMenu
                                    size="sm"
                                    className="wk-vib--textarea-corner"
                                />
                            </div>
                        </div>
                        <div className="wk-spacecreate-actions">
                            <button className="wk-spacecreate-btn wk-spacecreate-btn-cancel" onClick={this.handleClose}>
                                {t("base.common.cancel")}
                            </button>
                            <button
                                className="wk-spacecreate-btn wk-spacecreate-btn-primary"
                                onClick={this.handleCreate}
                                disabled={loading}
                            >
                                {loading ? t("app.spaceCreate.creating") : t("app.spaceCreate.create")}
                            </button>
                        </div>
                    </div>
                )}
            </WKModal>
        );
    }
}
