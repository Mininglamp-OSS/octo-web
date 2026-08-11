import { Button, Toast } from "@douyinfe/semi-ui";
import { IconCamera } from "@douyinfe/semi-icons";
import axios from "axios";
import { Channel } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import WKApp from "../../App";
import RouteContext from "../../Service/Context";
import { updateChannelAvatarCustom } from "../../Service/ChannelSettingService";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { I18nContext } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge } from "../avatarUpload";
import WKModal from "../WKModal";
import { GroupAvatarEditForm, GroupAvatarEditResult } from "../GroupAvatarEditModal";
import { fetchCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";
import "./index.css"

type ChannelAvatarDraftMode = "generated" | "uploaded"

export interface ChannelAvatarProps {
    channel:Channel
    showUpload?:boolean
    groupName?: string
    isNamedGroup?: boolean
    initialAvatarText?: string
    initialColorIndex?: number
    /** 路由上下文：保存/取消成功后关闭当前「群头像」页。 */
    context?: RouteContext<any>
    onFileUpload?:(f:File)=>Promise<void>
}

interface ChannelAvatarState {
    cropFile: File | null
    uploading: boolean
    customAvatarSaving: boolean
    customAvatarText: string
    customAvatarColorIndex?: number
    textChanged: boolean
    colorChanged: boolean
    draftMode: ChannelAvatarDraftMode
    pendingUploadFile: File | null
    uploadPreviewUrl?: string
}

export class ChannelAvatar extends Component<ChannelAvatarProps, ChannelAvatarState>{
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    $fileInput: any
    avatarEdit?: WKAvatarEditor|null
    state: ChannelAvatarState = {
        cropFile: null,
        uploading: false,
        customAvatarSaving: false,
        customAvatarText: this.props.initialAvatarText || "",
        customAvatarColorIndex: this.props.initialColorIndex,
        textChanged: false,
        colorChanged: false,
        draftMode: "generated",
        pendingUploadFile: null,
    }

    componentDidUpdate(prevProps: ChannelAvatarProps) {
        if (
            prevProps.initialAvatarText !== this.props.initialAvatarText ||
            prevProps.initialColorIndex !== this.props.initialColorIndex
        ) {
            if (this.state.uploadPreviewUrl) {
                URL.revokeObjectURL(this.state.uploadPreviewUrl)
            }
            this.setState({
                customAvatarText: this.props.initialAvatarText || "",
                customAvatarColorIndex: this.props.initialColorIndex,
                textChanged: false,
                colorChanged: false,
                draftMode: "generated",
                pendingUploadFile: null,
                uploadPreviewUrl: undefined,
            })
        }
    }

    componentWillUnmount() {
        if (this.state.uploadPreviewUrl) {
            URL.revokeObjectURL(this.state.uploadPreviewUrl)
        }
    }

    uploadAvatar(file: File) {
        const { channel } = this.props
        const param = new FormData();
        param.append("file", file);
        return axios.post(`groups/${channel.channelID}/avatar`, param, {
            headers: { "Content-Type": "multipart/form-data", "token": WKApp.loginInfo.token || "" },
        }).catch(error => {
            console.error('Avatar upload failed:', error);
            Toast.error(this.context.t('base.channelAvatar.uploadFailedRetry'));
            throw error;
        })
    }
    onFileChange() {
        const files = this.$fileInput?.files;
        if (!files || files.length === 0) return;
        this.showFile(files[0]);
    }
    chooseFile = () => {
        this.$fileInput.click();
    }
    closePage = () => {
        this.props.context?.pop()
    }
    cancelCustomAvatar = () => {
        if (this.state.customAvatarSaving || this.state.uploading) return
        this.closePage()
    }
    onGeneratedAvatarChange = (result: GroupAvatarEditResult) => {
        if (this.state.uploadPreviewUrl) {
            URL.revokeObjectURL(this.state.uploadPreviewUrl)
        }
        this.setState({
            customAvatarText: result.avatarText,
            customAvatarColorIndex: result.colorIndex,
            textChanged: result.textChanged === true,
            colorChanged: result.colorChanged === true,
            draftMode: "generated",
            pendingUploadFile: null,
            uploadPreviewUrl: undefined,
        })
    }
    saveCustomAvatar = async () => {
        const { channel } = this.props
        const { customAvatarText, customAvatarColorIndex, textChanged, colorChanged, draftMode } = this.state
        if (this.state.customAvatarSaving || this.state.uploading) return
        if (draftMode === "uploaded") {
            await this.saveUploadedAvatar()
            return
        }
        if (!textChanged && !colorChanged) {
            this.closePage()
            return
        }
        this.setState({ customAvatarSaving: true })
        try {
            await updateChannelAvatarCustom(channel, {
                avatarText: textChanged ? customAvatarText : undefined,
                avatarColor: colorChanged
                    ? (typeof customAvatarColorIndex === "number" ? customAvatarColorIndex : "")
                    : undefined,
                clearUploadedAvatar: true,
            })
            WKApp.shared.changeChannelAvatarTag(channel)
            void fetchCurrentImChannelInfo(channel)
            this.closePage()
        } catch (error) {
            console.error('Custom avatar update failed:', error);
            Toast.error(this.context.t('base.channelAvatar.updateFailedRetry'))
        } finally {
            this.setState({ customAvatarSaving: false })
        }
    }
    onFileClick(event: any) {
        event.target.value = ''  // 防止选中一个文件取消后不能再选中同一个文件
    }
    showFile(file: File) {
        if (isAvatarFileTooLarge(file)) {
            Toast.error(this.context.t('base.channelAvatar.fileTooLarge'));
            return;
        }
        this.setState({ cropFile: file })
    }
    cancelCrop = () => {
        if (this.state.uploading) return
        this.setState({ cropFile: null })
    }
    saveCrop = async () => {
        const canvas = this.avatarEdit?.getImageScaledToCanvas()
        if (!canvas || this.state.uploading) return

        let file: File
        try {
            file = await canvasToPngFile(canvas, "channelAvatarPicture.png")
        } catch {
            Toast.error(this.context.t('base.channelAvatar.imageProcessFailedRetry'))
            return
        }

        this.setState((state) => {
            if (state.uploadPreviewUrl) {
                URL.revokeObjectURL(state.uploadPreviewUrl)
            }
            return {
                cropFile: null,
                pendingUploadFile: file,
                uploadPreviewUrl: URL.createObjectURL(file),
                draftMode: "uploaded",
            }
        })
    }

    saveUploadedAvatar = async () => {
        const file = this.state.pendingUploadFile
        if (!file || this.state.uploading) return

        const { onFileUpload, channel } = this.props
        this.setState({ uploading: true })
        try {
            if (onFileUpload) {
                await onFileUpload(file)
            } else {
                await this.uploadAvatar(file)
                WKApp.shared.changeChannelAvatarTag(channel)
                // 触发 channelInfoListener，通知 Chat 等组件刷新头像
                void fetchCurrentImChannelInfo(channel)
            }
            this.closePage()
        } catch {
            if (onFileUpload) {
                Toast.error(this.context.t('base.channelAvatar.uploadFailedRetry'))
            }
        } finally {
            this.setState({ uploading: false })
        }
    }
    render() {
        const { channel,showUpload,groupName,isNamedGroup } = this.props
        const { cropFile, uploading, customAvatarSaving, uploadPreviewUrl } = this.state
        const editingDisabled = customAvatarSaving || uploading
        return <>
            <div className="wk-channelavatar">
                <div className="wk-channelavatar-avatar-wrap">
                    <img className="wk-channelavatar-avatar-img" src={uploadPreviewUrl || WKApp.shared.avatarChannel(channel)}></img>
                    <button
                        type="button"
                        className="wk-channelavatar-camera"
                        style={{display:showUpload?"flex":"none"}}
                        onClick={this.chooseFile}
                        disabled={editingDisabled}
                        aria-label="change-avatar-image"
                    >
                        <IconCamera />
                    </button>
                </div>
                {showUpload && <GroupAvatarEditForm
                    name={groupName || ""}
                    nameAsFallback={isNamedGroup === true}
                    initialAvatarText={this.props.initialAvatarText || ""}
                    initialColorIndex={this.props.initialColorIndex}
                    disabled={editingDisabled}
                    onChange={this.onGeneratedAvatarChange}
                />}
                <input  onClick={this.onFileClick.bind(this)}  type="file" multiple={false} accept="image/*" style={{ display: 'none' }} ref={(ref) => { this.$fileInput = ref }}  onChange={this.onFileChange.bind(this)}></input>
                {showUpload && <div className="wk-channelavatar-actions">
                    <Button onClick={this.cancelCustomAvatar}>{this.context.t('base.common.cancel')}</Button>
                    <Button loading={customAvatarSaving || uploading} onClick={this.saveCustomAvatar}>{this.context.t('base.common.save')}</Button>
                </div>}
            </div>
            <WKModal
                title={this.context.t('base.channelAvatar.cropAvatar')}
                visible={!!cropFile}
                onCancel={this.cancelCrop}
                width={460}
                className="wk-channelavatar-crop-modal"
                footerConfig={{
                    okText: this.context.t('base.common.save'),
                    cancelText: this.context.t('base.common.cancel'),
                    isOkLoading: uploading,
                    onOk: this.saveCrop,
                }}
                options={{
                    maskClosable: !uploading,
                    closeOnEsc: !uploading,
                }}
            >
                {cropFile && (
                    <div className="wk-channelavatar-crop-editor">
                        <WKAvatarEditor
                            ref={(ref) => {
                                this.avatarEdit = ref
                            }}
                            file={cropFile}
                        />
                    </div>
                )}
            </WKModal>
        </>
    }
}
