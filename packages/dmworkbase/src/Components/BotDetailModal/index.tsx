import React, { Component } from "react";
import { Button, Spin, Toast, Input } from "@douyinfe/semi-ui";
import {
    IconAlertCircle,
    IconCamera,
    IconChevronRight,
    IconEdit,
    IconTickCircle,
} from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import WKApp from "../../App";
import WKAvatar from "../WKAvatar";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { WKAvatarUploadPreview } from "../WKAvatarUploadPreview";
import WKAvatarPreviewImage from "../WKAvatarPreviewImage";
import AiBadge from "../AiBadge";
import ClawInfoModal from "../ClawInfoModal/ClawInfoModal";
import BotManageModal from "../BotManage";
import { I18nContext, t } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge, isGifImageFile } from "../avatarUpload";
import VoiceInputButton, { ReplaceMode, SelectionRange } from "../VoiceInputButton";
import BotDetailVM, {
    parseBotCommands,
    stripBotDetailDisplayName,
} from "../../bridge/profileDetail/BotDetailVM";
import "./index.css";

interface BotDetailModalProps {
    uid: string;
    visible: boolean;
    onClose: () => void;
    onChat: (channel: Channel) => void;
}

export default class BotDetailModal extends Component<BotDetailModalProps> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private $fileInput: HTMLInputElement | null = null;
    private avatarEdit: WKAvatarEditor | null = null;
    private descriptionRef = React.createRef<HTMLTextAreaElement>();
    private vm: BotDetailVM;
    private unsubscribeVM?: () => void;

    constructor(props: BotDetailModalProps) {
        super(props);
        this.vm = new BotDetailVM(props.uid, {
            getLoginUid: () => WKApp.loginInfo.uid,
            getToken: () => WKApp.loginInfo.token || "",
            getSpaceId: () => WKApp.shared.currentSpaceId,
            fetchChannelInfo: (uid) => WKSDK.shared().channelManager.fetchChannelInfo(
                new Channel(uid, ChannelTypePerson)
            ),
            refreshChannelInfo: (uid) => WKSDK.shared().channelManager.fetchChannelInfo(
                new Channel(uid, ChannelTypePerson)
            ),
            onAvatarChanged: (uid) => {
                WKApp.shared.changeChannelAvatarTag(new Channel(uid, ChannelTypePerson));
                WKSDK.shared().channelManager.fetchChannelInfo(new Channel(uid, ChannelTypePerson));
                this.forceUpdate();
            },
        });
    }

    private handleDescriptionVoiceTranscribed = (
        text: string,
        mode: ReplaceMode,
        savedRange?: SelectionRange
    ) => {
        this.vm.updateDescriptionDraftWithTranscription(text, mode, savedRange);
    };

    componentDidMount() {
        this.unsubscribeVM = this.vm.addListener(() => this.forceUpdate());
        this.vm.mount();
        if (this.props.uid) {
            this.vm.loadBotInfo();
        }
    }

    componentDidUpdate(prevProps: BotDetailModalProps) {
        if (prevProps.uid !== this.props.uid && this.props.uid) {
            this.vm.setUid(this.props.uid);
        }
        if (prevProps.visible && !this.props.visible) {
            this.vm.resetTransientState();
        }
    }

    componentWillUnmount() {
        this.unsubscribeVM?.();
        this.vm.unmount();
    }

    stripDisplayName = (value: string) => {
        return stripBotDetailDisplayName(value);
    };

    handleChat = () => {
        const { uid, onChat, onClose } = this.props;
        // WuKongIM DM 只认裸 uid
        onChat(new Channel(uid, ChannelTypePerson));
        onClose();
    };

    handleClose = () => {
        this.vm.resetTransientState();
        this.props.onClose();
    };

    // === Owner 头像编辑 ===
    handleAvatarClick = () => {
        if (!this.vm.isOwner() || this.vm.state.uploadingAvatar) return;
        this.$fileInput?.click();
    };

    handleAvatarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.handleAvatarClick();
        }
    };

    handleEditDescriptionKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.handleStartEditDescription();
        }
    };

    handleEditRemarkKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.handleStartEditRemark();
        }
    };

    handleAvatarInputClick = (event: React.MouseEvent<HTMLInputElement>) => {
        // 允许连续选中同一文件
        (event.target as HTMLInputElement).value = "";
    };

    uploadBotAvatar = async (file: File): Promise<boolean> => {
        const result = await this.vm.uploadAvatar(file);
        if (result === "ok") {
            Toast.success(t("base.botDetail.avatarUpdated"));
            this.forceUpdate();
            return true;
        }
        if (result === "failed") {
            Toast.error(t("base.botDetail.avatarUploadFailed"));
        }
        return false;
    };

    handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        if (isAvatarFileTooLarge(file)) {
            Toast.error(t("base.channelAvatar.fileTooLarge"));
            return;
        }
        if (isGifImageFile(file)) {
            this.vm.setAvatarPreviewFile(file);
            return;
        }
        this.vm.setAvatarCropFile(file);
    };

    handleAvatarCropCancel = () => {
        if (this.vm.state.uploadingAvatar) return;
        this.vm.setAvatarCropFile(null);
    };

    handleAvatarPreviewCancel = () => {
        if (this.vm.state.uploadingAvatar) return;
        this.vm.setAvatarPreviewFile(null);
    };

    handleAvatarPreviewSave = async () => {
        const { avatarPreviewFile } = this.vm.state;
        if (!avatarPreviewFile) return;
        const uploaded = await this.uploadBotAvatar(avatarPreviewFile);
        if (uploaded) {
            this.vm.setAvatarPreviewFile(null);
        }
    };

    handleAvatarCropSave = async () => {
        const canvas = this.avatarEdit?.getImageScaledToCanvas();
        if (!canvas) return;
        let file: File;
        try {
            file = await canvasToPngFile(canvas, "botAvatarPicture.png");
        } catch {
            Toast.error(t("base.botDetail.imageProcessFailedRetry"));
            return;
        }
        const uploaded = await this.uploadBotAvatar(file);
        if (uploaded) {
            this.vm.setAvatarCropFile(null);
        }
    };

    // === Owner 简介编辑 ===
    handleStartEditDescription = () => {
        this.vm.startEditDescription();
    };

    handleCancelEditDescription = () => {
        this.vm.cancelEditDescription();
    };

    handleSaveDescription = async () => {
        const result = await this.vm.saveDescription();
        if (result === "ok") {
            Toast.success(t("base.botDetail.descriptionUpdated"));
        } else if (result === "failed") {
            Toast.error(t("base.botDetail.descriptionUpdateFailed"));
        }
    };

    // === 个人备注编辑 ===
    handleStartEditRemark = () => {
        this.vm.startEditRemark();
    };

    handleCancelEditRemark = () => {
        this.vm.cancelEditRemark();
    };

    handleSaveRemark = async () => {
        const result = await this.vm.saveRemark();
        if (result === "ok") {
            Toast.success(t("base.botDetail.remarkUpdated"));
        } else if (result === "failed") {
            Toast.error(t("base.botDetail.remarkUpdateFailed"));
        }
    };

    isOwner = () => {
        return this.vm.isOwner();
    };

    handleShowApply = () => {
        const { name } = this.vm.state;
        this.vm.showApplyInput(
            t("base.botDetail.apply.defaultMessage", {
                values: { name: this.stripDisplayName(name) },
            }),
        );
    };

    handleSubmitApply = async () => {
        const result = await this.vm.submitApply();
        if (result === "ok") {
            Toast.success(t("base.botDetail.apply.sent"));
        } else if (result === "failed") {
            Toast.error(t("base.botDetail.apply.failed"));
        }
    };

    handleViewClawInfo = () => {
        this.vm.openClawInfo();
    };

    handleOpenBotManage = (event?: React.MouseEvent) => {
        event?.stopPropagation();
        this.vm.openBotManage();
    };

    render() {
        const { visible, uid } = this.props;
        const {
            loading,
            name,
            remark,
            username,
            description,
            creatorName,
            botCommands,
            isFriend,
            applying,
            showApplyInput,
            applyRemark,
            uploadingAvatar,
            editingDescription,
            descriptionDraft,
            savingDescription,
            editingRemark,
            remarkDraft,
            savingRemark,
            reported,
            showClawInfo,
            showBotManage,
            avatarCropFile,
            avatarPreviewFile,
        } = this.vm.state;
        const isOwner = this.isOwner();
        const botName = this.stripDisplayName(name);
        const displayName = this.stripDisplayName(remark || name);
        const displayDescription = description
            ? this.stripDisplayName(description)
            : t("base.botDetail.noDescription");

        const commands = parseBotCommands(botCommands);

        return (
            <>
            <WKModal
                title={null}
                visible={visible}
                onCancel={this.handleClose}
                className="wk-bot-detail-modal"
                options={{ closable: false }}
            >
                <div className="wk-bot-detail-content">
                    <div className="wk-bot-detail-route-header">
                        <button
                            type="button"
                            className="wk-bot-detail-route-close"
                            onClick={this.handleClose}
                            aria-label={t("base.common.close")}
                        >
                            <span className="wk-bot-detail-route-close-icon" aria-hidden="true" />
                        </button>
                    </div>
                    {loading ? (
                        <div className="wk-bot-detail-loading">
                            <Spin size="large" />
                        </div>
                    ) : (
                        <>
                        <div className="wk-bot-detail-scroll">
                            <div className="wk-bot-detail-header">
                                {isOwner ? (
                                    <div
                                        className="wk-bot-detail-avatar wk-bot-detail-avatar--owner"
                                        onClick={this.handleAvatarClick}
                                        onKeyDown={this.handleAvatarKeyDown}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={t("base.botDetail.changeAvatar")}
                                    >
                                        <WKAvatar channel={new Channel(uid, ChannelTypePerson)} />
                                        <div className="wk-bot-detail-avatar-overlay" aria-hidden="true">
                                            <IconCamera />
                                        </div>
                                        {uploadingAvatar && (
                                            <div className="wk-bot-detail-avatar-loading">
                                                <Spin />
                                            </div>
                                        )}
                                        <input
                                            ref={(ref) => { this.$fileInput = ref; }}
                                            type="file"
                                            accept="image/*"
                                            multiple={false}
                                            className="wk-bot-detail-file-input"
                                            onClick={this.handleAvatarInputClick}
                                            onChange={this.handleAvatarFileChange}
                                        />
                                    </div>
                                ) : (
                                    <div className="wk-bot-detail-avatar wk-bot-detail-avatar--preview">
                                        <WKAvatarPreviewImage channel={new Channel(uid, ChannelTypePerson)} />
                                    </div>
                                )}
                                <div className="wk-bot-detail-heading">
                                    <div className="wk-bot-detail-name">
                                        <span className="wk-bot-detail-name-text">{displayName}</span>
                                        <AiBadge />
                                    </div>
                                    <div className="wk-bot-detail-id">@{username}</div>
                                    {isOwner && reported !== null && (
                                        <div
                                            className={`wk-bot-detail-octopush-chip ${
                                                reported
                                                    ? "wk-bot-detail-octopush-chip--reported"
                                                    : "wk-bot-detail-octopush-chip--unmanaged"
                                            }`}
                                        >
                                            <span className="wk-bot-detail-octopush-status">
                                                <span className="wk-bot-detail-octopush-chip-icon">
                                                    {reported ? <IconTickCircle /> : <IconAlertCircle />}
                                                </span>
                                                <span className="wk-bot-detail-octopush-chip-text">
                                                    {reported
                                                        ? t("base.botDetail.reported")
                                                        : t("base.botDetail.notReported")}
                                                </span>
                                                {!reported && (
                                                    <button
                                                        type="button"
                                                        className="wk-bot-detail-help-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                        title={t("base.botDetail.reportHelp")}
                                                        aria-label={t("base.botDetail.help")}
                                                    >
                                                        ?
                                                    </button>
                                                )}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="wk-bot-detail-section">
                                <div className="wk-bot-detail-row wk-bot-detail-row--editable">
                                    <div className="wk-bot-detail-row-main">
                                        <div className="wk-bot-detail-label">{t("base.botDetail.remark")}</div>
                                        {editingRemark ? (
                                            <div className="wk-bot-detail-editor">
                                                <Input
                                                    value={remarkDraft}
                                                    onChange={(v) => this.vm.setRemarkDraft(v)}
                                                    placeholder={t("base.botDetail.remarkPlaceholder")}
                                                    maxLength={30}
                                                />
                                                <div className="wk-bot-detail-editor-actions">
                                                    <Button
                                                        size="small"
                                                        onClick={this.handleCancelEditRemark}
                                                        disabled={savingRemark}
                                                    >
                                                        {t("base.common.cancel")}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        theme="solid"
                                                        type="primary"
                                                        loading={savingRemark}
                                                        onClick={this.handleSaveRemark}
                                                    >
                                                        {t("base.botDetail.save")}
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="wk-bot-detail-value">
                                                {remark ? this.stripDisplayName(remark) : <span className="wk-bot-detail-empty">{t("base.botDetail.noRemark")}</span>}
                                            </div>
                                        )}
                                    </div>
                                    {!editingRemark && (
                                        <Button
                                            className="wk-bot-detail-value-edit"
                                            theme="borderless"
                                            type="tertiary"
                                            size="small"
                                            icon={<IconEdit />}
                                            onClick={this.handleStartEditRemark}
                                            onKeyDown={this.handleEditRemarkKeyDown}
                                            aria-label={t("base.botDetail.editRemark")}
                                            title={t("base.botDetail.editRemark")}
                                        />
                                    )}
                                </div>
                                {remark && (
                                    <div className="wk-bot-detail-row">
                                        <div className="wk-bot-detail-label">{t("base.botDetail.nickname")}</div>
                                        <div className="wk-bot-detail-value wk-bot-detail-value--right">{botName}</div>
                                    </div>
                                )}
                            </div>

                            <div className="wk-bot-detail-section">
                                <div className="wk-bot-detail-description">
                                    <div className="wk-bot-detail-field-header">
                                        <div className="wk-bot-detail-label">{t("base.botDetail.description")}</div>
                                        {isOwner && !editingDescription && (
                                            <Button
                                                className="wk-bot-detail-edit-action"
                                                theme="borderless"
                                                type="tertiary"
                                                size="small"
                                                icon={<IconEdit />}
                                                onClick={this.handleStartEditDescription}
                                                onKeyDown={this.handleEditDescriptionKeyDown}
                                                aria-label={t("base.botDetail.editDescription")}
                                            >
                                                {t("base.botDetail.edit")}
                                            </Button>
                                        )}
                                    </div>
                                    {isOwner && editingDescription ? (
                                        <div>
                                            <div className="wk-bot-detail-textarea-wrap">
                                                <textarea
                                                    ref={this.descriptionRef}
                                                    className="wk-bot-detail-textarea"
                                                    value={descriptionDraft}
                                                    onChange={(e) => this.vm.setDescriptionDraft(e.target.value)}
                                                    placeholder={t("base.botDetail.descriptionPlaceholder")}
                                                    maxLength={200}
                                                    rows={3}
                                                />
                                                <VoiceInputButton
                                                    inputRef={this.descriptionRef}
                                                    onTranscribed={this.handleDescriptionVoiceTranscribed}
                                                    getCurrentText={() => this.vm.state.descriptionDraft}
                                                    showModeMenu
                                                    size="sm"
                                                    className="wk-vib--textarea-corner"
                                                />
                                            </div>
                                            <div className="wk-bot-detail-editor-actions">
                                                <Button
                                                    size="small"
                                                    onClick={this.handleCancelEditDescription}
                                                    disabled={savingDescription}
                                                >
                                                    {t("base.common.cancel")}
                                                </Button>
                                                <Button
                                                    size="small"
                                                    theme="solid"
                                                    type="primary"
                                                    loading={savingDescription}
                                                    onClick={this.handleSaveDescription}
                                                >
                                                    {t("base.botDetail.save")}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="wk-bot-detail-description-text">{displayDescription}</div>
                                    )}
                                </div>
                            </div>

                            {(creatorName || commands.length > 0) && (
                                <div className="wk-bot-detail-section">
                                    {creatorName && (
                                        <div className="wk-bot-detail-row">
                                            <div className="wk-bot-detail-label">{t("base.botDetail.creator")}</div>
                                            <div className="wk-bot-detail-value wk-bot-detail-value--right">{creatorName}</div>
                                        </div>
                                    )}
                                    {commands.length > 0 && (
                                        <div className="wk-bot-detail-command-block">
                                            <div className="wk-bot-detail-label">{t("base.botDetail.commands")}</div>
                                            <div className="wk-bot-detail-command-list">
                                                {commands.map((cmd, i) => (
                                                    <div key={i} className="wk-bot-detail-cmd">
                                                        <span className="wk-bot-detail-cmd-name">{cmd.cmd}</span>
                                                        <span className="wk-bot-detail-cmd-desc">{cmd.remark}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {isOwner && (
                                <div className="wk-bot-detail-section">
                                    <button
                                        type="button"
                                        onClick={this.handleOpenBotManage}
                                        className="wk-bot-detail-nav-row"
                                        aria-label={t("base.botManage.title")}
                                    >
                                        <span>{t("base.botManage.title")}</span>
                                        <IconChevronRight className="wk-bot-detail-nav-chevron" />
                                    </button>
                                    {reported !== null && (
                                        <button
                                            type="button"
                                            onClick={this.handleViewClawInfo}
                                            className={`wk-bot-detail-nav-row${!reported ? " wk-bot-detail-nav-row--disabled" : ""}`}
                                            disabled={!reported}
                                            aria-label={t("base.botDetail.viewClawInfo")}
                                            title={!reported ? t("base.botDetail.reportHelp") : undefined}
                                        >
                                            <span className="wk-bot-detail-nav-main">
                                                <span className="wk-bot-detail-claw-action-icon" aria-hidden="true">🦞</span>
                                                <span>{t("base.botDetail.viewClawInfo")}</span>
                                            </span>
                                            {reported && <IconChevronRight className="wk-bot-detail-nav-chevron" />}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="wk-bot-detail-actions">
                            {isFriend ? (
                                <Button
                                    className="wk-bot-detail-primary-action"
                                    theme="solid"
                                    type="primary"
                                    block
                                    onClick={this.handleChat}
                                >
                                    {t("base.botDetail.sendMessage")}
                                </Button>
                            ) : showApplyInput ? (
                                <div className="wk-bot-detail-apply">
                                    <div className="wk-bot-detail-apply-label">{t("base.botDetail.apply.messageLabel")}</div>
                                    <Input
                                        value={applyRemark}
                                        onChange={(v) => this.vm.setApplyRemark(v)}
                                        placeholder={t("base.botDetail.apply.messagePlaceholder")}
                                    />
                                    <Button
                                        className="wk-bot-detail-primary-action"
                                        theme="solid"
                                        type="primary"
                                        block
                                        loading={applying}
                                        disabled={!applyRemark}
                                        onClick={this.handleSubmitApply}
                                    >
                                        {t("base.botDetail.apply.send")}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    className="wk-bot-detail-primary-action"
                                    theme="solid"
                                    type="primary"
                                    block
                                    onClick={this.handleShowApply}
                                >
                                    {t("base.botDetail.addFriend")}
                                </Button>
                            )}
                        </div>
                        </>
                    )}
                </div>
            </WKModal>
            <ClawInfoModal
                botId={uid}
                botName={name}
                visible={showClawInfo}
                onClose={() => this.vm.closeClawInfo()}
            />
            {isOwner && (
                <BotManageModal
                    robotId={uid}
                    visible={visible && showBotManage}
                    onClose={() => this.vm.closeBotManage()}
                />
            )}
            <WKModal
                title={t("base.botDetail.previewAvatar")}
                visible={visible && !!avatarPreviewFile}
                onCancel={this.handleAvatarPreviewCancel}
                width={460}
                className="wk-bot-avatar-preview-modal"
                footerConfig={{
                    okText: t("base.botDetail.save"),
                    cancelText: t("base.common.cancel"),
                    isOkLoading: uploadingAvatar,
                    onOk: this.handleAvatarPreviewSave,
                }}
                options={{
                    maskClosable: !uploadingAvatar,
                    closeOnEsc: !uploadingAvatar,
                }}
            >
                {avatarPreviewFile && (
                    <WKAvatarUploadPreview file={avatarPreviewFile} shape="bot" />
                )}
            </WKModal>
            <WKModal
                title={t("base.botDetail.cropAvatar")}
                visible={visible && !!avatarCropFile}
                onCancel={this.handleAvatarCropCancel}
                width={460}
                className="wk-bot-avatar-crop-modal"
                footerConfig={{
                    okText: t("base.botDetail.save"),
                    cancelText: t("base.common.cancel"),
                    isOkLoading: uploadingAvatar,
                    onOk: this.handleAvatarCropSave,
                }}
                options={{
                    maskClosable: !uploadingAvatar,
                    closeOnEsc: !uploadingAvatar,
                }}
            >
                {avatarCropFile && (
                    <div className="wk-bot-avatar-crop-editor">
                        <WKAvatarEditor
                            ref={(ref) => {
                                this.avatarEdit = ref;
                            }}
                            file={avatarCropFile}
                        />
                    </div>
                )}
            </WKModal>
        </>
        );
    }
}
