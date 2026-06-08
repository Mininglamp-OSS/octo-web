import type ConversationContext from "../Conversation/context";
import React from "react";
import { Component, ReactNode, createRef } from "react";
import { Toast } from "@douyinfe/semi-ui";
import IconClick from "../IconClick";

import "./index.css"

interface ImageToolbarProps {
    conversationContext: ConversationContext
    icon: string | React.ReactNode
}

export default class ImageToolbar extends Component<ImageToolbarProps> {
    pasteListen!: (event: any) => void
    $fileInput: any
    private containerRef = createRef<HTMLDivElement>()

    componentDidMount() {
        const { conversationContext } = this.props

        // 粘贴图片 → 入队（#143：不再立即发送）
        // 当主群聊和子区同时打开时，两个 ImageToolbar 实例各挂一次全局 paste 事件。
        // 通过比较焦点所在的 .wk-messageinput-box 和当前 toolbar 所在的 .wk-messageinput-box
        // 确保只有焦点所在的输入框响应粘贴，避免重复上传。
        this.pasteListen = (event: any) => {
            if (event.defaultPrevented) return
            const activeBox = document.activeElement?.closest?.('.wk-messageinput-box')
            const myBox = this.containerRef.current?.closest?.('.wk-messageinput-box')
            if (!activeBox || !myBox || activeBox !== myBox) return

            const files: File[] = Array.from(event.clipboardData?.files || [])
            const images = files.filter(f => f.type && f.type.startsWith('image/'))
            if (images.length > 0) {
                event.preventDefault()
                const err = conversationContext.addPendingAttachments(images)
                if (err) Toast.error(err)
            }
        }
        document.addEventListener('paste', this.pasteListen)

        // 拖拽图片 → 入队（#52 fix 的图片路径统一入队）
        conversationContext.setDragFileCallback((file: File) => {
            const err = conversationContext.addPendingAttachments([file])
            if (err) Toast.error(err)
        })
    }

    componentWillUnmount() {
        document.removeEventListener('paste', this.pasteListen)
    }

    onFileClick = (event: any) => {
        event.target.value = ''
    }

    onFileChange = () => {
        const { conversationContext } = this.props
        const files: File[] = Array.from(this.$fileInput.files || [])
        if (files.length === 0) return
        const err = conversationContext.addPendingAttachments(files)
        if (err) Toast.error(err)
    }

    chooseFile = () => {
        this.$fileInput.click()
    }

    render(): ReactNode {
        const { icon } = this.props
        return (
            <div className="wk-imagetoolbar" ref={this.containerRef}>
                <IconClick
                    icon={typeof icon === 'string' ? <img src={icon} alt="" /> : icon}
                    onClick={this.chooseFile}
                    size="sm"
                />
                <input
                    onClick={this.onFileClick}
                    onChange={this.onFileChange}
                    ref={(ref) => { this.$fileInput = ref }}
                    type="file"
                    multiple={true}
                    accept="image/*"
                    style={{ display: 'none' }}
                />
            </div>
        )
    }
}
