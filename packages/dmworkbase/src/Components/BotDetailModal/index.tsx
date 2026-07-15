import React, { Component } from "react";
import { Button, Spin, Toast, Input } from "@douyinfe/semi-ui";
import {
    IconAlertCircle,
    IconCamera,
    IconChevronRight,
    IconEdit,
    IconTickCircle,
} from "@douyinfe/semi-icons";
import axios from "axios";
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
import AgentCardService from "../../Service/AgentCardService";
import { I18nContext, t } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge, isGifImageFile } from "../avatarUpload";
import VoiceInputButton, { ReplaceMode, SelectionRange } from "../VoiceInputButton";
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
    remark: string;
    username: string;
    description: string;
    creatorName: string;
    creatorUid: string;
    botCommands: string;
    isFriend: boolean;
    applying: boolean;
    showApplyInput: boolean;
    applyRemark: string;
    uploadingAvatar: boolean;
    editingDescription: boolean;
    descriptionDraft: string;
    savingDescription: boolean;
    editingRemark: boolean;
    remarkDraft: string;
    savingRemark: boolean;
    // Agent Card 上报状态（true=已上报，false=未上报，null=加载中）
    reported: boolean | null;
    reportStatusLoading: boolean;
    showClawInfo: boolean;
    showBotManage: boolean;
    avatarCropFile: File | null;
    avatarPreviewFile: File | null;
}

export default class BotDetailModal extends Component<BotDetailModalProps, BotDetailModalState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private $fileInput: HTMLInputElement | null = null;
    private avatarEdit: WKAvatarEditor | null = null;
    private mounted = false;
    private descriptionRef = React.createRef<HTMLTextAreaElement>();

    private isCurrentUid = (uid: string) => {
        return this.mounted && this.props.uid === uid;
    };

    private handleDescriptionVoiceTranscribed = (
        text: string,
        mode: ReplaceMode,
        savedRange?: SelectionRange
    ) => {
        if (mode === "all") {
            this.setState({ descriptionDraft: text.slice(0, 200) });
        } else if (mode === "selection" && savedRange) {
            this.setState((prev) => {
                const before = prev.descriptionDraft.slice(0, savedRange.from);
                const after = prev.descriptionDraft.slice(savedRange.to);
                const budget = Math.max(0, 200 - before.length - after.length);
                return { descriptionDraft: before + text.slice(0, budget) + after };
            });
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.descriptionDraft.length;
                const before = prev.descriptionDraft.slice(0, pos);
                const after = prev.descriptionDraft.slice(pos);
                const budget = Math.max(0, 200 - before.length - after.length);
                return { descriptionDraft: before + text.slice(0, budget) + after };
            });
        }
    };

    state: BotDetailModalState = {
        loading: true,
        name: "",
        remark: "",
        username: "",
        description: "",
        creatorName: "",
        creatorUid: "",
        botCommands: "",
        isFriend: false,
        applying: false,
        showApplyInput: false,
        applyRemark: "",
        uploadingAvatar: false,
        editingDescription: false,
        descriptionDraft: "",
        savingDescription: false,
        editingRemark: false,
        remarkDraft: "",
        savingRemark: false,
        reported: null,
        reportStatusLoading: false,
        showClawInfo: false,
        showBotManage: false,
        avatarCropFile: null,
        avatarPreviewFile: null,
    };

    componentDidMount() {
        this.mounted = true;
        if (this.props.uid) {
            this.loadBotInfo();
        }
    }

    componentDidUpdate(prevProps: BotDetailModalProps) {
        if (prevProps.uid !== this.props.uid && this.props.uid) {
            // 复用同一 BotDetailModal 实例切到新 bot 时，先关掉「Bot 管理」子模态。
            // 否则在 loadBotInfo() 重算 isOwner 之前会有一帧用「旧 bot 的 creatorUid」
            // 判定 owner，却把「新 uid」透传给 BotManageModal —— 可能让用户在所有权
            // 重新校验前对一个未必属于自己的 bot 触发一次群数据加载（codex P2）。
            this.setState({ showBotManage: false });
            this.loadBotInfo();
        }
        if (prevProps.visible && !this.props.visible) {
            this.setState({
                avatarCropFile: null,
                avatarPreviewFile: null,
                showBotManage: false,
                showClawInfo: false,
            });
        }
    }

    componentWillUnmount() {
        this.mounted = false;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    loadReportStatus = async () => {
        const requestedUid = this.props.uid;
        if (!requestedUid) return;

        const isStale = () => !this.isCurrentUid(requestedUid);

        this.setState({ reported: null, reportStatusLoading: true });
        try {
            const result = await AgentCardService.getReportStatus(requestedUid);
            if (isStale()) return; // 如果已切换到其他 bot，忽略旧请求
            this.setState({ reported: result });
        } catch (error) {
            if (isStale()) return;
            console.error("[BotDetailModal] loadReportStatus failed:", error);
            // 网络错误时不设置 reported，避免误导用户
            // reported 保持 null，不显示 OctoPush chip 和龙虾按钮
        } finally {
            if (!isStale()) {
                this.setState({ reportStatusLoading: false });
            }
        }
    };

    loadBotInfo = async () => {
        const requestedUid = this.props.uid;
        if (!requestedUid) return;

        // Reset all bot-specific state at the start of each load so that
        // a new uid (e.g. when the modal instance is reused by BotStore /
        // GlobalSearch / Subscribers) cannot see leftover state from the
        // previously displayed bot.
        this.setState({
            loading: true,
            name: "",
            remark: "",
            username: "",
            description: "",
            creatorName: "",
            creatorUid: "",
            botCommands: "",
            isFriend: false,
            applying: false,
            showApplyInput: false,
            applyRemark: "",
            uploadingAvatar: false,
            editingDescription: false,
            descriptionDraft: "",
            savingDescription: false,
            avatarCropFile: null,
            avatarPreviewFile: null,
            editingRemark: false,
            remarkDraft: "",
            savingRemark: false,
            reported: null,
            reportStatusLoading: false,
            showClawInfo: false,
            showBotManage: false,
        });

        const isStale = () => !this.isCurrentUid(requestedUid);

        try {
            // 用 user detail API 获取完整信息（包含 follow）
            const data = await WKApp.apiClient.get(`users/${requestedUid}`);
            if (isStale()) return;
            const creatorUid = data.bot_creator_uid || "";
            this.setState({
                loading: false,
                name: data.name || requestedUid,
                remark: data.remark || "",
                username: data.username || requestedUid,
                description: data.bot_description || "",
                creatorName: data.bot_creator_name || "",
                creatorUid: creatorUid,
                botCommands: data.bot_commands || "",
                isFriend: data.follow === 1,
                editingDescription: false,
            }, () => {
                // 只有当前用户是 bot 的创建者时才加载上报状态
                if (this.isOwner()) {
                    this.loadReportStatus();
                }
            });
        } catch {
            // fallback to channel info
            try {
                const channelInfo = await WKSDK.shared().channelManager.fetchChannelInfo(
                    new Channel(requestedUid, ChannelTypePerson)
                );
                if (isStale()) return;
                const creatorUid = channelInfo?.orgData?.bot_creator_uid || "";
                this.setState({
                    loading: false,
                    name: channelInfo?.title || requestedUid,
                    remark: channelInfo?.orgData?.remark || "",
                    username: requestedUid,
                    description: channelInfo?.orgData?.bot_description || "",
                    creatorName: channelInfo?.orgData?.bot_creator_name || "",
                    creatorUid: creatorUid,
                    botCommands: channelInfo?.orgData?.bot_commands || "",
                    isFriend: channelInfo?.orgData?.follow === 1,
                    editingDescription: false,
                }, () => {
                    // 只有当前用户是 bot 的创建者时才加载上报状态
                    if (this.isOwner()) {
                        this.loadReportStatus();
                    }
                });
            } catch {
                if (isStale()) return;
                // Keep the reset done above (creatorUid="") so isOwner()
                // can never return true for a bot we failed to load.
                this.setState({
                    loading: false,
                    name: requestedUid,
                    remark: "",
                    username: requestedUid,
                    description: "",
                    creatorName: "",
                    creatorUid: "",
                    botCommands: "",
                    isFriend: false,
                    editingDescription: false,
                });
            }
        }
    };

    stripDisplayName = (value: string) => {
        return value.replace(/\*\*/g, "");
    };

    handleChat = () => {
        const { uid, onChat, onClose } = this.props;
        // WuKongIM DM 只认裸 uid
        onChat(new Channel(uid, ChannelTypePerson));
        onClose();
    };

    handleClose = () => {
        this.setState({
            avatarCropFile: null,
            avatarPreviewFile: null,
            showBotManage: false,
            showClawInfo: false,
        });
        this.props.onClose();
    };

    // === Owner 头像编辑 ===
    handleAvatarClick = () => {
        if (!this.isOwner() || this.state.uploadingAvatar) return;
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
        const { uid } = this.props;
        const param = new FormData();
        param.append("file", file);
        this.setState({ uploadingAvatar: true });
        try {
            await axios.post(`users/${uid}/avatar`, param, {
                headers: {
                    "Content-Type": "multipart/form-data",
                    "token": WKApp.loginInfo.token || "",
                },
            });
            if (!this.isCurrentUid(uid)) return false;
            WKApp.shared.changeChannelAvatarTag(new Channel(uid, ChannelTypePerson));
            // 触发 channelInfoListener，通知其他组件刷新头像
            WKSDK.shared().channelManager.fetchChannelInfo(new Channel(uid, ChannelTypePerson));
            Toast.success(t("base.botDetail.avatarUpdated"));
            this.forceUpdate();
            return true;
        } catch (err) {
            if (this.isCurrentUid(uid)) {
                Toast.error(t("base.botDetail.avatarUploadFailed"));
            }
            return false;
        } finally {
            if (this.isCurrentUid(uid)) {
                this.setState({ uploadingAvatar: false });
            }
        }
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
            this.setState({ avatarPreviewFile: file });
            return;
        }
        this.setState({ avatarCropFile: file });
    };

    handleAvatarCropCancel = () => {
        if (this.state.uploadingAvatar) return;
        this.setState({ avatarCropFile: null });
    };

    handleAvatarPreviewCancel = () => {
        if (this.state.uploadingAvatar) return;
        this.setState({ avatarPreviewFile: null });
    };

    handleAvatarPreviewSave = async () => {
        const { avatarPreviewFile } = this.state;
        if (!avatarPreviewFile) return;
        const uploaded = await this.uploadBotAvatar(avatarPreviewFile);
        if (uploaded) {
            this.setState({ avatarPreviewFile: null });
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
            this.setState({ avatarCropFile: null });
        }
    };

    // === Owner 简介编辑 ===
    handleStartEditDescription = () => {
        if (!this.isOwner()) return;
        const { description } = this.state;
        const raw = description.replace(/\*\*/g, "");
        this.setState({ editingDescription: true, descriptionDraft: raw });
    };

    handleCancelEditDescription = () => {
        this.setState({ editingDescription: false, descriptionDraft: "" });
    };

    handleSaveDescription = async () => {
        const requestedUid = this.props.uid;
        const { descriptionDraft } = this.state;
        const isCurrent = () => this.isCurrentUid(requestedUid);
        this.setState({ savingDescription: true });
        try {
            await WKApp.apiClient.put(`robot/${requestedUid}/description`, {
                description: descriptionDraft,
            });
            if (!isCurrent()) return;
            Toast.success(t("base.botDetail.descriptionUpdated"));
            this.setState({
                description: descriptionDraft,
                editingDescription: false,
                descriptionDraft: "",
            });
        } catch {
            if (isCurrent()) {
                Toast.error(t("base.botDetail.descriptionUpdateFailed"));
            }
        } finally {
            if (isCurrent()) {
                this.setState({ savingDescription: false });
            }
        }
    };

    // === 个人备注编辑 ===
    handleStartEditRemark = () => {
        this.setState({
            editingRemark: true,
            remarkDraft: this.stripDisplayName(this.state.remark),
        });
    };

    handleCancelEditRemark = () => {
        this.setState({ editingRemark: false, remarkDraft: "" });
    };

    handleSaveRemark = async () => {
        const requestedUid = this.props.uid;
        const { remarkDraft } = this.state;
        const remark = remarkDraft.trim();
        const isCurrent = () => this.mounted && this.props.uid === requestedUid;
        this.setState({ savingRemark: true });
        try {
            await WKApp.apiClient.put("friend/remark", { uid: requestedUid, remark });
            if (!isCurrent()) return;
            Toast.success(t("base.botDetail.remarkUpdated"));
            this.setState({
                remark,
                editingRemark: false,
                remarkDraft: "",
            });
            Promise.resolve(
                WKSDK.shared().channelManager.fetchChannelInfo(new Channel(requestedUid, ChannelTypePerson))
            ).catch((error: unknown) => {
                console.warn("[BotDetailModal] refresh channel after remark failed:", error);
            });
        } catch {
            if (isCurrent()) {
                Toast.error(t("base.botDetail.remarkUpdateFailed"));
            }
        } finally {
            if (isCurrent()) {
                this.setState({ savingRemark: false });
            }
        }
    };

    isOwner = () => {
        const { creatorUid } = this.state;
        const loginUid = WKApp.loginInfo.uid;
        return !!creatorUid && !!loginUid && creatorUid === loginUid;
    };

    handleShowApply = () => {
        const { name } = this.state;
        this.setState({
            showApplyInput: true,
            applyRemark: t("base.botDetail.apply.defaultMessage", {
                values: { name: this.stripDisplayName(name) },
            }),
        });
    };

    handleSubmitApply = async () => {
        const requestedUid = this.props.uid;
        const { applyRemark } = this.state;
        const isCurrent = () => this.isCurrentUid(requestedUid);
        this.setState({ applying: true });
        try {
            const body: any = { to_uid: requestedUid, remark: applyRemark };
            const spaceId = WKApp.shared.currentSpaceId;
            if (spaceId) {
                body.space_id = spaceId;
            }
            await WKApp.apiClient.post("friend/apply", body);
            if (!isCurrent()) return;
            Toast.success(t("base.botDetail.apply.sent"));
            this.setState({ showApplyInput: false });
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
            }
            this.refreshTimer = setTimeout(() => {
                if (this.isCurrentUid(requestedUid)) {
                    this.loadBotInfo();
                }
            }, 500);
        } catch {
            if (isCurrent()) {
                Toast.error(t("base.botDetail.apply.failed"));
            }
        } finally {
            if (isCurrent()) {
                this.setState({ applying: false });
            }
        }
    };

    handleViewClawInfo = () => {
        this.setState({ showClawInfo: true });
    };

    handleOpenBotManage = (event?: React.MouseEvent) => {
        event?.stopPropagation();
        this.setState({ showBotManage: true });
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
        } = this.state;
        const isOwner = this.isOwner();
        const botName = this.stripDisplayName(name);
        const displayName = this.stripDisplayName(remark || name);
        const displayDescription = description
            ? this.stripDisplayName(description)
            : t("base.botDetail.noDescription");

        let commands: { cmd: string; remark: string }[] = [];
        try {
            if (botCommands) commands = JSON.parse(botCommands);
        } catch {}

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
                                                    onChange={(v) => this.setState({ remarkDraft: v })}
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
                                                    onChange={(e) => this.setState({ descriptionDraft: e.target.value.slice(0, 200) })}
                                                    placeholder={t("base.botDetail.descriptionPlaceholder")}
                                                    maxLength={200}
                                                    rows={3}
                                                />
                                                <VoiceInputButton
                                                    inputRef={this.descriptionRef}
                                                    onTranscribed={this.handleDescriptionVoiceTranscribed}
                                                    getCurrentText={() => this.state.descriptionDraft}
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
                                        onChange={(v) => this.setState({ applyRemark: v })}
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
                onClose={() => this.setState({ showClawInfo: false })}
            />
            {isOwner && (
                <BotManageModal
                    robotId={uid}
                    visible={visible && showBotManage}
                    onClose={() => this.setState({ showBotManage: false })}
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
