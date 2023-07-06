import { Button } from "@douyinfe/semi-ui";
import axios from "axios";
import { Channel } from "wukongimjssdk/lib/sdk";
import React from "react";
import { Component } from "react";
import WKApp from "../../App";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { WKAvatarEditor } from "../WKAvatarEditor";
import "./index.css"

export interface ChannelAvatarProps {
    channel:Channel
    showUpload?:boolean
    context?: RouteContext<any>
    onFileUpload?:(f:File)=>Promise<void>
}
export class ChannelAvatar extends Component<ChannelAvatarProps>{
    $fileInput: any
    avatarEdit?: WKAvatarEditor|null

    uploadAvatar(file: File) {
        const { channel } = this.props
        const param = new FormData();
        param.append("file", file);
        return axios.post(`groups/${channel.channelID}/avatar`, param, {
            headers: { "Content-Type": "multipart/form-data", "token": WKApp.loginInfo.token || "" },
        }).catch(error => {
            console.log('文件上传失败！->', error);
        })
    }
    onFileChange() {
        let file = this.$fileInput.files[0];
        this.showFile(file);
    }
    chooseFile = () => {
        this.$fileInput.click();
    }
    onFileClick(event: any) {
        event.target.value = ''  // 防止选中一个文件取消后不能再选中同一个文件
    }
    showFile(file: any) {
        const { context,onFileUpload } = this.props
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
                            if (bob) {
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
                                    await this.uploadAvatar(file)
                                    WKApp.shared.changeChannelAvatarTag()
                                    finishButtonContext.loading(false)
                                    context.pop()
                                    this.setState({})
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
                <Button onClick={this.chooseFile}>更换头像</Button>
                <input  onClick={this.onFileClick.bind(this)}  type="file" multiple={false} accept="image/*" style={{ display: 'none' }} ref={(ref) => { this.$fileInput = ref }}  onChange={this.onFileChange.bind(this)}></input>
            </div>
        </div>
    }
}