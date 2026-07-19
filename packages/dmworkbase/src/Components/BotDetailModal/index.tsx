import React, { Component } from "react";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import WKApp from "../../App";
import WKAvatar from "../WKAvatar";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { WKAvatarUploadPreview } from "../WKAvatarUploadPreview";
import WKAvatarPreviewImage from "../WKAvatarPreviewImage";
import ClawInfoModal from "../ClawInfoModal/ClawInfoModal";
import BotManageModal from "../BotManage";
import { I18nContext, t } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge, isGifImageFile } from "../avatarUpload";
import type { ReplaceMode, SelectionRange } from "../VoiceInputButton";
import BotDetailVM, {
    parseBotCommands,
    stripBotDetailDisplayName,
} from "../../bridge/profileDetail/BotDetailVM";
import BotDetailView from "../../ui/profileDetail/BotDetailView";
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
        if (prevProps.uid !== this.props.uid) {
            this.vm.setUid(this.props.uid || "");
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
                visible={visible && !showBotManage}
                onCancel={this.handleClose}
                className="wk-bot-detail-modal"
                options={{ closable: false }}
            >
                <BotDetailView
                    loading={loading}
                    displayName={displayName}
                    botName={botName}
                    username={username}
                    remark={remark ? this.stripDisplayName(remark) : ""}
                    displayDescription={displayDescription}
                    creatorName={creatorName}
                    commands={commands}
                    isOwner={isOwner}
                    isFriend={isFriend}
                    reported={reported}
                    uploadingAvatar={uploadingAvatar}
                    editingRemark={editingRemark}
                    remarkDraft={remarkDraft}
                    savingRemark={savingRemark}
                    editingDescription={editingDescription}
                    descriptionDraft={descriptionDraft}
                    savingDescription={savingDescription}
                    showApplyInput={showApplyInput}
                    applyRemark={applyRemark}
                    applying={applying}
                    ownerAvatar={<WKAvatar channel={new Channel(uid, ChannelTypePerson)} />}
                    previewAvatar={<WKAvatarPreviewImage channel={new Channel(uid, ChannelTypePerson)} />}
                    fileInputRef={(ref) => { this.$fileInput = ref; }}
                    descriptionRef={this.descriptionRef}
                    labels={{
                        close: t("base.common.close"),
                        changeAvatar: t("base.botDetail.changeAvatar"),
                        reported: t("base.botDetail.reported"),
                        notReported: t("base.botDetail.notReported"),
                        reportHelp: t("base.botDetail.reportHelp"),
                        help: t("base.botDetail.help"),
                        remark: t("base.botDetail.remark"),
                        noRemark: t("base.botDetail.noRemark"),
                        remarkPlaceholder: t("base.botDetail.remarkPlaceholder"),
                        editRemark: t("base.botDetail.editRemark"),
                        nickname: t("base.botDetail.nickname"),
                        description: t("base.botDetail.description"),
                        editDescription: t("base.botDetail.editDescription"),
                        edit: t("base.botDetail.edit"),
                        descriptionPlaceholder: t("base.botDetail.descriptionPlaceholder"),
                        noDescription: t("base.botDetail.noDescription"),
                        creator: t("base.botDetail.creator"),
                        commands: t("base.botDetail.commands"),
                        botManageTitle: t("base.botManage.title"),
                        viewClawInfo: t("base.botDetail.viewClawInfo"),
                        sendMessage: t("base.botDetail.sendMessage"),
                        addFriend: t("base.botDetail.addFriend"),
                        applyMessageLabel: t("base.botDetail.apply.messageLabel"),
                        applyMessagePlaceholder: t("base.botDetail.apply.messagePlaceholder"),
                        applySend: t("base.botDetail.apply.send"),
                        save: t("base.botDetail.save"),
                        cancel: t("base.common.cancel"),
                    }}
                    onClose={this.handleClose}
                    onAvatarClick={this.handleAvatarClick}
                    onAvatarKeyDown={this.handleAvatarKeyDown}
                    onAvatarInputClick={this.handleAvatarInputClick}
                    onAvatarFileChange={this.handleAvatarFileChange}
                    onRemarkDraftChange={(value) => this.vm.setRemarkDraft(value)}
                    onStartEditRemark={this.handleStartEditRemark}
                    onEditRemarkKeyDown={this.handleEditRemarkKeyDown}
                    onCancelEditRemark={this.handleCancelEditRemark}
                    onSaveRemark={this.handleSaveRemark}
                    onStartEditDescription={this.handleStartEditDescription}
                    onEditDescriptionKeyDown={this.handleEditDescriptionKeyDown}
                    onDescriptionDraftChange={(value) => this.vm.setDescriptionDraft(value)}
                    onDescriptionTranscribed={this.handleDescriptionVoiceTranscribed}
                    getCurrentDescriptionText={() => this.vm.state.descriptionDraft}
                    onCancelEditDescription={this.handleCancelEditDescription}
                    onSaveDescription={this.handleSaveDescription}
                    onOpenBotManage={this.handleOpenBotManage}
                    onViewClawInfo={this.handleViewClawInfo}
                    onChat={this.handleChat}
                    onShowApply={this.handleShowApply}
                    onApplyRemarkChange={(value) => this.vm.setApplyRemark(value)}
                    onSubmitApply={this.handleSubmitApply}
                />
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
