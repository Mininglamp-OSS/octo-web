import { Button, Toast } from "@douyinfe/semi-ui";
import axios from "axios";
import { Channel, WKSDK } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import WKApp from "../../App";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { I18nContext } from "../../i18n";
import { isAvatarFileTooLarge } from "../avatarUpload";
import "./index.css"

export interface ChannelAvatarProps {
    channel:Channel
    showUpload?:boolean
    context?: RouteContext<any>
    onFileUpload?:(f:File)=>Promise<void>
}
export class ChannelAvatar extends Component<ChannelAvatarProps>{
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    $fileInput: any
    avatarEdit?: WKAvatarEditor|null

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
    showFile(file: any) {
        const { context,onFileUpload,channel } = this.props
        if (isAvatarFileTooLarge(file)) {
            Toast.error(this.context.t('base.channelAvatar.fileTooLarge'));
            return;
        }
        let finishButtonContext:FinishButtonContext
        if (context) {
            context.push(<WKAvatarEditor ref={(rf)=>{
                this.avatarEdit = rf
            }} file={file} />, new RouteContextConfig({
                showFinishButton: true,
                onFinishContext(ctx) {
                    finishButtonContext =ctx
                },
                onFinish: async () => {
                    let canvas = this.avatarEdit?.getImageScaledToCanvas()
                    if(canvas) {
                        canvas.toBlob( async (bob: Blob | null)  => {
                            if (!bob) {
                                Toast.error(this.context.t('base.channelAvatar.imageProcessFailedRetry'));
                                return;
                            }
                            const file = new File([bob], `channelAvatarPicture.png`, {
                                type: "image/png"
                            });
                            if(onFileUpload) {
                                finishButtonContext.loading(true)
                                await onFileUpload(file)
                                finishButtonContext.loading(false)
                                context.pop()
                            }else{
                                finishButtonContext.loading(true)
                                try {
                                    await this.uploadAvatar(file)
                                    WKApp.shared.changeChannelAvatarTag(channel)
                                    // 触发 channelInfoListener，通知 Chat 等组件刷新头像
                                    WKSDK.shared().channelManager.fetchChannelInfo(channel)
                                    context.pop()
                                    this.setState({})
                                } finally {
                                    finishButtonContext.loading(false)
                                }
                            }
                        })
                    }
                }
            }))
        }
    }
    render() {
        const { channel,showUpload } = this.props
        return <div className="wk-channelavatar">
            <div className="wk-channelavatar-avatar">
                <img style={{"width":"200px","height":"200px"}} src={WKApp.shared.avatarChannel(channel)}></img>
            </div>
            <div className="wk-channelavatar-upload" style={{display:showUpload?"block":"none"}}>
                <Button onClick={this.chooseFile}>{this.context.t('base.channelAvatar.changeAvatar')}</Button>
                <input  onClick={this.onFileClick.bind(this)}  type="file" multiple={false} accept="image/*" style={{ display: 'none' }} ref={(ref) => { this.$fileInput = ref }}  onChange={this.onFileChange.bind(this)}></input>
            </div>
        </div>
    }
}
