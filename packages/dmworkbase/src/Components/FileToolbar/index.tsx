import React from "react";
import { Component, ReactNode, createRef } from "react";
import ConversationContext from "../Conversation/context";
import { Toast } from "@douyinfe/semi-ui";
import IconClick from "../IconClick";
import { t } from "../../i18n";

import "./index.css";

interface FileToolbarProps {
  conversationContext: ConversationContext;
  icon: string | React.ReactNode;
}

export default class FileToolbar extends Component<FileToolbarProps> {
  $fileInput: HTMLInputElement | null = null;
  pasteListen!: (event: ClipboardEvent) => void;
  private containerRef = createRef<HTMLDivElement>();

  componentDidMount() {
    const { conversationContext } = this.props;

    // 粘贴文件 → 入队
    // 当主群聊和子区同时打开时，两个 FileToolbar 实例各挂一次全局 paste 事件。
    // 通过比较焦点所在的 .wk-messageinput-box 和当前 toolbar 所在的 .wk-messageinput-box
    // 确保只有焦点所在的输入框响应粘贴，避免重复上传。
    this.pasteListen = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const activeBox = document.activeElement?.closest?.(
        ".wk-messageinput-box"
      );
      const myBox = this.containerRef.current?.closest?.(
        ".wk-messageinput-box"
      );
      if (!activeBox || !myBox || activeBox !== myBox) return;

      // 优先从 files 获取
      let files: File[] = Array.from(event.clipboardData?.files || []);

      // 截图粘贴时 files 可能为空，需要从 items 中获取
      if (files.length === 0 && event.clipboardData?.items) {
        const items: DataTransferItem[] = Array.from(event.clipboardData.items);
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        // 每次粘贴时获取最新的 conversationContext，避免闭包捕获旧引用
        const { conversationContext } = this.props;
        // 粘贴来源标记为 'paste'
        const err = conversationContext.addPendingAttachments(files, "paste");
        if (err) Toast.error(err);
      }
    };
    document.addEventListener("paste", this.pasteListen);

    // 拖拽文件 → 入队（视为上传来源）
    conversationContext.setDragFileCallback((file: File) => {
      const err = conversationContext.addPendingAttachments([file], "upload");
      if (err) Toast.error(err);
    });
  }

  componentWillUnmount() {
    document.removeEventListener("paste", this.pasteListen);
    // 清理 drag 回调，避免内存泄漏
    this.props.conversationContext.setDragFileCallback(() => {});
  }

  onFileClick = (event: React.MouseEvent<HTMLInputElement>) => {
    (event.target as HTMLInputElement).value = "";
  };

  onFileChange = () => {
    const { conversationContext } = this.props;
    const files = Array.from(this.$fileInput?.files || []);
    if (!files || files.length === 0) return;

    // 同名文件轻量提示
    const currentNames = new Set(
      conversationContext.getPendingAttachments().map((f) => f.name)
    );
    const hasDuplicate = files.some((f) => currentNames.has(f.name));
    if (hasDuplicate) {
      Toast.warning(t("base.fileToolbar.duplicateAdded"));
    }

    // 通过上传按钮选择的文件，标记为 'upload'
    const err = conversationContext.addPendingAttachments(files, "upload");
    if (err) {
      Toast.error(err);
    }
  };

  chooseFile = () => {
    this.$fileInput?.click();
  };

  render(): ReactNode {
    const { icon } = this.props;

    return (
      <div className="wk-filetoolbar" ref={this.containerRef}>
        <IconClick
          icon={typeof icon === "string" ? <img src={icon} alt="" /> : icon}
          onClick={this.chooseFile}
          size="sm"
        />
        <input
          onClick={this.onFileClick}
          onChange={this.onFileChange}
          ref={(ref) => {
            this.$fileInput = ref;
          }}
          type="file"
          multiple={true}
          style={{ display: "none" }}
        />
      </div>
    );
  }
}
