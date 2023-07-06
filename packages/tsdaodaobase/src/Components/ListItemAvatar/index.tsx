import React, { useRef } from "react";
import { Component, ReactNode } from "react";
import { ListItemProps } from "../ListItem";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { WKAvatarEditor } from "../WKAvatarEditor";

export interface ListItemAvatarProps extends ListItemProps {
    avatar?: JSX.Element
    context?: RouteContext<any>
    onFileUpload:(f:File)=>Promise<void>
}

export class ListItemAvatar extends Component<ListItemAvatarProps>{
    $fileInput: any
    avatarEdit?: WKAvatarEditor|null

    onFileChange() {
        let file = this.$fileInput.files[0];
        this.showFile(file);
    }
    onFileClick(event: any) {
        event.target.value = ''  // 防止选中一个文件取消后不能再选中同一个文件
    }
    chooseFile = () => {
        this.$fileInput.click();
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
                                const file = new File([bob], `profilePicture.png`, {
                                    type: "image/png"
                                });
                                if(onFileUpload) {
                                    finishButtonContext.loading(true)
                                    await onFileUpload(file)
                                    finishButtonContext.loading(false)
                                    context.pop()
                                }
                            }
    
                        })
                    }
                }
            }))
        }
    }
    render(): ReactNode {
        const { title, avatar } = this.props
        return <div className="wk-list-item wk-list-item-avatar" onClick={this.chooseFile}>
            <input onClick={this.onFileClick.bind(this)} onChange={this.onFileChange.bind(this)} ref={(ref) => { this.$fileInput = ref }} type="file" multiple={false} accept="image/*" style={{ display: 'none' }} />
            <div className="wk-list-item-title">
                {title}
            </div>
            <div className="wk-list-item-subtitle">
                {avatar}
            </div>
        </div>
    }
}
