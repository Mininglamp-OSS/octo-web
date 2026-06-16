import React from "react";
import { Component, ReactNode } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { ListItemProps } from "../ListItem";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { t } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge, isGifImageFile } from "../avatarUpload";
import { WKAvatarUploadPreview } from "../WKAvatarUploadPreview";

export interface ListItemAvatarProps extends ListItemProps {
    avatar?: JSX.Element
    context?: RouteContext<any>
    onFileUpload:(f:File)=>Promise<void>
}

export class ListItemAvatar extends Component<ListItemAvatarProps>{
    $fileInput: any
    avatarEdit?: WKAvatarEditor|null

    onFileChange = () => {
        let file = this.$fileInput.files[0];
        this.showFile(file);
    }
    onFileClick = (event: any) => {
        event.target.value = ''  // 防止选中一个文件取消后不能再选中同一个文件
    }
    chooseFile = () => {
        this.$fileInput.click();
    }
    async showFile(file: File) {
        const { context,onFileUpload } = this.props
        if (!file || !onFileUpload) return;
        if (isAvatarFileTooLarge(file)) {
            Toast.error(t("base.channelAvatar.fileTooLarge"));
            return;
        }
        if (isGifImageFile(file)) {
            let finishButtonContext:FinishButtonContext | undefined
            if (context) {
                context.push(<WKAvatarUploadPreview file={file} />, new RouteContextConfig({
                    title: t("base.channelAvatar.previewAvatar"),
                    showFinishButton: true,
                    onFinishContext(ctx) {
                        finishButtonContext = ctx
                    },
                    onFinish: async () => {
                        try {
                            finishButtonContext?.loading(true)
                            await onFileUpload(file);
                            finishButtonContext?.loading(false)
                            context.pop()
                        } catch {
                            Toast.error(t("base.channelAvatar.uploadFailedRetry"));
                        } finally {
                            finishButtonContext?.loading(false)
                        }
                    }
                }))
                return;
            }
            try {
                await onFileUpload(file);
            } catch {
                Toast.error(t("base.channelAvatar.uploadFailedRetry"));
            }
            return;
        }
        let finishButtonContext:FinishButtonContext | undefined
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
                        let file: File;
                        try {
                            file = await canvasToPngFile(canvas, `profilePicture.png`);
                        } catch {
                            Toast.error(t("base.channelAvatar.imageProcessFailedRetry"));
                            return;
                        }
                        try {
                            if(finishButtonContext) {
                                finishButtonContext.loading(true)
                            }
                            await onFileUpload(file)
                            finishButtonContext?.loading(false)
                            context.pop()
                        } catch {
                            Toast.error(t("base.channelAvatar.uploadFailedRetry"));
                        } finally {
                            finishButtonContext?.loading(false)
                        }
                    }
                }
            }))
            return;
        }
        try {
            await onFileUpload(file);
        } catch {
            Toast.error(t("base.channelAvatar.uploadFailedRetry"));
        }
    }
    render(): ReactNode {
        const { title, avatar } = this.props
        return <div className="wk-list-item wk-list-item-avatar" onClick={this.chooseFile}>
            <input onClick={this.onFileClick} onChange={this.onFileChange} ref={(ref) => { this.$fileInput = ref }} type="file" multiple={false} accept="image/*" style={{ display: 'none' }} />
            <div className="wk-list-item-title">
                {title}
            </div>
            <div className="wk-list-item-subtitle">
                {avatar}
            </div>
        </div>
    }
}
