import React, { Component } from "react";
import { Input, Toast, Button } from "@douyinfe/semi-ui";
import { IconCopy, IconLink } from "@douyinfe/semi-icons";
import { Space, SpaceService } from "../../Service/SpaceService";
import { I18nContext, t } from "../../i18n";
import { wkConfirm } from "../WKModal";
import VoiceInputButton, { ReplaceMode, SelectionRange } from "../VoiceInputButton";
import "./index.css";

export interface SpaceSettingsProps {
    space: Space;
    onClose: () => void;
    onMembersClick: () => void;
    onSpaceUpdated: () => void;
}

interface SpaceSettingsState {
    name: string;
    description: string;
    saving: boolean;
    inviteCode: string;
    inviteLoading: boolean;
}

export default class SpaceSettings extends Component<SpaceSettingsProps, SpaceSettingsState> {
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

    constructor(props: SpaceSettingsProps) {
        super(props);
        this.state = {
            name: props.space.name,
            description: props.space.description || "",
            saving: false,
            inviteCode: "",
            inviteLoading: false,
        };
    }

    handleSave = async () => {
        const { name, description } = this.state;
        if (!name.trim()) {
            Toast.warning(t("base.spaceSettings.validation.nameRequired"));
            return;
        }
        this.setState({ saving: true });
        try {
            await SpaceService.shared.updateSpace(this.props.space.space_id, {
                name: name.trim(),
                description: description.trim(),
            });
            Toast.success(t("base.spaceSettings.saveSuccess"));
            this.props.onSpaceUpdated();
        } catch {
            Toast.error(t("base.spaceSettings.saveFailed"));
        } finally {
            this.setState({ saving: false });
        }
    };

    handleLeave = () => {
        wkConfirm({
            title: t("base.spaceSettings.leaveTitle"),
            content: t("base.spaceSettings.leaveContent"),
            okText: t("base.common.ok"),
            cancelText: t("base.common.cancel"),
            onOk: async () => {
                try {
                    await SpaceService.shared.leaveSpace(this.props.space.space_id);
                    Toast.success(t("base.spaceSettings.leaveSuccess"));
                    this.props.onSpaceUpdated();
                    this.props.onClose();
                } catch {
                    Toast.error(t("base.spaceSettings.operationFailed"));
                }
            },
        });
    };

    handleDisband = () => {
        wkConfirm({
            title: t("base.spaceSettings.disbandTitle"),
            content: t("base.spaceSettings.disbandContent"),
            okType: "danger",
            okText: t("base.spaceSettings.disbandAction"),
            cancelText: t("base.common.cancel"),
            onOk: async () => {
                try {
                    await SpaceService.shared.disbandSpace(this.props.space.space_id);
                    Toast.success(t("base.spaceSettings.disbandSuccess"));
                    this.props.onSpaceUpdated();
                    this.props.onClose();
                } catch {
                    Toast.error(t("base.spaceSettings.operationFailed"));
                }
            },
        });
    };

    handleInvite = async () => {
        this.setState({ inviteLoading: true });
        try {
            const resp = await SpaceService.shared.createInvite(this.props.space.space_id);
            this.setState({ inviteCode: resp.invite_code, inviteLoading: false });
        } catch {
            Toast.error(t("base.spaceSettings.inviteGenerateFailed"));
            this.setState({ inviteLoading: false });
        }
    };

    copyInviteCode = () => {
        const { inviteCode } = this.state;
        navigator.clipboard.writeText(inviteCode).then(() => {
            Toast.success(t("base.spaceSettings.inviteCodeCopied"));
        });
    };

    copyInviteLink = () => {
        const { inviteCode } = this.state;
        const link = `${window.location.origin}/join/${inviteCode}`;
        navigator.clipboard.writeText(link).then(() => {
            Toast.success(t("base.spaceSettings.inviteLinkCopied"));
        });
    };

    isOwner() {
        return this.props.space.role === 1;
    }

    isAdmin() {
        return this.props.space.role === 1 || this.props.space.role === 2;
    }

    render() {
        const { onClose, onMembersClick } = this.props;
        const { name, description, saving } = this.state;
        const isOwner = this.isOwner();

        return (
            <div className="wk-spacesettings">
                <div className="wk-spacesettings-header">
                    <div className="wk-spacesettings-back" onClick={onClose}>
                        ←
                    </div>
                    <span className="wk-spacesettings-title">{t("base.spaceSettings.title")}</span>
                </div>
                <div className="wk-spacesettings-body">
                    <div className="wk-spacesettings-field">
                        <label className="wk-spacesettings-label">{t("base.spaceSettings.name")}</label>
                        <Input
                            value={name}
                            onChange={(v) => this.setState({ name: v })}
                            maxLength={32}
                            disabled={!isOwner}
                        />
                    </div>
                    <div className="wk-spacesettings-field">
                        <label className="wk-spacesettings-label">{t("base.spaceSettings.description")}</label>
                        <div style={{ position: "relative" }}>
                            <textarea
                                ref={this.descriptionRef}
                                className="wk-spacesettings-textarea"
                                value={description}
                                onChange={(e) => this.setState({ description: e.target.value.slice(0, 200) })}
                                maxLength={200}
                                rows={3}
                                disabled={!isOwner}
                            />
                            {isOwner && (
                                <VoiceInputButton
                                    inputRef={this.descriptionRef}
                                    onTranscribed={this.handleVoiceTranscribed}
                                    getCurrentText={() => this.state.description}
                                    showModeMenu
                                    size="sm"
                                    className="wk-vib--textarea-corner"
                                />
                            )}
                        </div>
                    </div>
                    {isOwner && (
                        <button
                            className="wk-spacesettings-btn wk-spacesettings-btn-primary"
                            onClick={this.handleSave}
                            disabled={saving}
                        >
                            {saving
                                ? t("base.spaceSettings.saving")
                                : t("base.spaceSettings.saveChanges")}
                        </button>
                    )}

                    {this.isAdmin() && (
                        <div className="wk-spacesettings-section">
                            <label className="wk-spacesettings-label">{t("base.spaceSettings.inviteMembers")}</label>
                            {!this.state.inviteCode ? (
                                <button
                                    className="wk-spacesettings-btn wk-spacesettings-btn-primary"
                                    onClick={this.handleInvite}
                                    disabled={this.state.inviteLoading}
                                >
                                    {this.state.inviteLoading
                                        ? t("base.spaceSettings.generating")
                                        : t("base.spaceSettings.generateInviteLink")}
                                </button>
                            ) : (
                                <div className="wk-spacesettings-invite-result">
                                    <div className="wk-spacesettings-invite-row">
                                        <span className="wk-spacesettings-invite-label">{t("base.spaceSettings.inviteCodeLabel")}</span>
                                        <code className="wk-spacesettings-invite-code">{this.state.inviteCode}</code>
                                        <button className="wk-spacesettings-copy-btn" onClick={this.copyInviteCode}>{t("base.spaceSettings.copy")}</button>
                                    </div>
                                    <div className="wk-spacesettings-invite-row">
                                        <button className="wk-spacesettings-copy-btn wk-spacesettings-copy-link" onClick={this.copyInviteLink}>
                                            {t("base.spaceSettings.copyInviteLink")}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="wk-spacesettings-section">
                        <div className="wk-spacesettings-menu-item" onClick={onMembersClick}>
                            <span>{t("base.spaceSettings.memberManagement")}</span>
                            <span className="wk-spacesettings-arrow">→</span>
                        </div>
                    </div>

                    <div className="wk-spacesettings-danger-zone">
                        <button
                            className="wk-spacesettings-btn wk-spacesettings-btn-warning"
                            onClick={this.handleLeave}
                        >
                            {t("base.spaceSettings.leaveAction")}
                        </button>
                        {isOwner && (
                            <button
                                className="wk-spacesettings-btn wk-spacesettings-btn-danger"
                                onClick={this.handleDisband}
                            >
                                {t("base.spaceSettings.disbandAction")}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}
