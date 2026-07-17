import { Button, Toast } from "@douyinfe/semi-ui";
import axios from "axios";
import { Channel, WKSDK } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import WKApp from "../../App";
import RouteContext from "../../Service/Context";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { I18nContext } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge } from "../avatarUpload";
import WKModal from "../WKModal";
import "./index.css"

export interface ChannelAvatarProps {
    channel:Channel
    showUpload?:boolean
    /** @deprecated 头像裁剪已由独立弹窗承载，不再使用父级路由上下文。 */
    context?: RouteContext<any>
    onFileUpload?:(f:File)=>Promise<void>
}

interface ChannelAvatarState {
    cropFile: File | null
    uploading: boolean
}

export class ChannelAvatar extends Component<ChannelAvatarProps, ChannelAvatarState>{
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    $fileInput: any
    avatarEdit?: WKAvatarEditor|null
    state: ChannelAvatarState = {
        cropFile: null,
        uploading: false,
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

        const { onFileUpload, channel } = this.props
        this.setState({ uploading: true })
        try {
            if (onFileUpload) {
                await onFileUpload(file)
            } else {
                await this.uploadAvatar(file)
                WKApp.shared.changeChannelAvatarTag(channel)
                // 触发 channelInfoListener，通知 Chat 等组件刷新头像
                WKSDK.shared().channelManager.fetchChannelInfo(channel)
            }
            this.setState({ cropFile: null })
        } catch {
            if (onFileUpload) {
                Toast.error(this.context.t('base.channelAvatar.uploadFailedRetry'))
            }
        } finally {
            this.setState({ uploading: false })
        }
    }
    render() {
        const { channel,showUpload } = this.props
        const { cropFile, uploading } = this.state
        return <>
            <div className="wk-channelavatar">
                <div className="wk-channelavatar-avatar">
                    <img style={{"width":"200px","height":"200px"}} src={WKApp.shared.avatarChannel(channel)}></img>
                </div>
                <div className="wk-channelavatar-upload" style={{display:showUpload?"block":"none"}}>
                    <Button onClick={this.chooseFile}>{this.context.t('base.channelAvatar.changeAvatar')}</Button>
                    <input  onClick={this.onFileClick.bind(this)}  type="file" multiple={false} accept="image/*" style={{ display: 'none' }} ref={(ref) => { this.$fileInput = ref }}  onChange={this.onFileChange.bind(this)}></input>
                </div>
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
