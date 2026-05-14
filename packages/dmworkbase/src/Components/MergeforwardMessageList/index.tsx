import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
  Message,
  MessageContentType,
  MessageText,
} from "wukongimjssdk";
import React from "react";
import { Component, ReactNode } from "react";
import { ImageContent } from "../../Messages/Image";
import { FileContent } from "../../Messages/File/FileContent";
import { MessageContentTypeConst } from "../../Service/Const";
import MergeforwardContent from "../../Messages/Mergeforward";
import { dateFormat, getTimeStringAutoShort2 } from "../../Utils/time";
import WKAvatar, { isBot } from "../WKAvatar";
import AiBadge from "../AiBadge";
import WKApp from "../../App";
import { downloadFile } from "../../Utils/download";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";

import MergeforwardCard from "../../ui/message/MergeforwardCard";

import "./index.css";

export interface MergeforwardMessageListProps {
  mergeforwardContent: MergeforwardContent;
  onClose?: () => void;
  /** 弹窗是否可见；从 true→false 时重置导航栈 */
  visible?: boolean;
  /** 导航状态变化回调：通知父组件当前标题和是否可返回 */
  onNavigateChange?: (info: { title: string; canGoBack: boolean }) => void;
  /** 外部触发返回（由父组件的返回按钮调用） */
  goBackRef?: React.MutableRefObject<(() => void) | null>;
}

interface MergeforwardMessageListState {
  previewImgSrc: string | null;
  previewImageContent: ImageContent | null;
  /** 导航栈：点击嵌套合并转发时 push，点返回时 pop */
  contentStack: MergeforwardContent[];
}

export default class MergeforwardMessageList extends Component<
  MergeforwardMessageListProps,
  MergeforwardMessageListState
> {
  constructor(props: MergeforwardMessageListProps) {
    super(props);
    this.state = {
      previewImgSrc: null,
      previewImageContent: null,
      contentStack: [],
    };
  }

  componentDidMount() {
    this.syncGoBackRef();
    this.notifyNavigateChange();
  }

  componentDidUpdate(_prevProps: MergeforwardMessageListProps, prevState: MergeforwardMessageListState) {
    if (prevState.contentStack !== this.state.contentStack) {
      this.syncGoBackRef();
      this.notifyNavigateChange();
    }
    // props 变化时重置导航栈（用户打开了另一条合并转发消息）
    if (_prevProps.mergeforwardContent !== this.props.mergeforwardContent) {
      this.setState({ contentStack: [] });
    }
    // 弹窗关闭时重置导航栈
    if (_prevProps.visible && !this.props.visible) {
      this.setState({ contentStack: [] });
    }
  }

  private syncGoBackRef() {
    if (this.props.goBackRef) {
      this.props.goBackRef.current = this.state.contentStack.length > 0
        ? () => this.goBack()
        : null;
    }
  }

  private notifyNavigateChange() {
    if (this.props.onNavigateChange) {
      const { contentStack } = this.state;
      const currentContent = contentStack.length > 0
        ? contentStack[contentStack.length - 1]
        : this.props.mergeforwardContent;
      this.props.onNavigateChange({
        title: this.getTitle(currentContent),
        canGoBack: contentStack.length > 0,
      });
    }
  }

  private goBack() {
    this.setState((prev) => ({
      contentStack: prev.contentStack.slice(0, -1),
    }));
  }

  getTitle(content: MergeforwardContent) {
    if (content.channelType === ChannelTypeGroup) {
      return "群的聊天记录";
    }

    const names = content.users.map((v) => {
      return v.name;
    });

    return `${names.join("、")}的聊天记录`;
  }

  getTimeline(content: MergeforwardContent) {
    if (!content.msgs || content.msgs.length === 0) {
      return "";
    }
    if (content.msgs.length === 1) {
      const msg = content.msgs[0];
      return dateFormat(new Date(msg.timestamp * 1000), "yyyy-MM-dd");
    }
    const firstMsg = content.msgs[0];
    const lastMsg = content.msgs[content.msgs.length - 1];

    return `${dateFormat(
      new Date(firstMsg.timestamp * 1000),
      "yyyy-MM-dd"
    )} ~ ${dateFormat(new Date(lastMsg.timestamp * 1000), "yyyy-MM-dd")}`;
  }

  imageScale(
    orgWidth: number,
    orgHeight: number,
    maxWidth = 250,
    maxHeight = 250
  ) {
    let actSize = { width: orgWidth, height: orgHeight };
    if (orgWidth > orgHeight) {
      //横图
      if (orgWidth > maxWidth) {
        // 横图超过最大宽度
        let rate = maxWidth / orgWidth; // 缩放比例
        actSize.width = maxWidth;
        actSize.height = orgHeight * rate;
      }
    } else if (orgWidth < orgHeight) {
      //竖图
      if (orgHeight > maxHeight) {
        let rate = maxHeight / orgHeight; // 缩放比例
        actSize.width = orgWidth * rate;
        actSize.height = maxHeight;
      }
    } else if (orgWidth === orgHeight) {
      if (orgWidth > maxWidth) {
        let rate = maxWidth / orgWidth; // 缩放比例
        actSize.width = maxWidth;
        actSize.height = orgHeight * rate;
      }
    }
    return actSize;
  }
  getImageSrc(content: ImageContent) {
    if (content.url && content.url !== "") {
      // 等待发送的消息
      return WKApp.dataSource.commonDataSource.getImageURL(content.url, {
        width: content.width,
        height: content.height,
      });
    }
    return content.imgData;
  }

  getFileURL(content: FileContent): string {
    if (content.url && content.url !== "") {
      const fileUrl = WKApp.dataSource.commonDataSource.getFileURL(content.url);
      if (fileUrl && !fileUrl.startsWith("http")) {
        return window.location.origin + "/" + fileUrl.replace(/^\//, "");
      }
      return fileUrl;
    }
    return "";
  }

  private cachedRootStyle?: CSSStyleDeclaration;

  private getRootStyle(): CSSStyleDeclaration {
    if (!this.cachedRootStyle) {
      this.cachedRootStyle = getComputedStyle(document.documentElement);
    }
    return this.cachedRootStyle;
  }

  getFileExtColor(extension: string): string {
    const ext = (extension || "").toLowerCase();
    const style = this.getRootStyle();
    switch (ext) {
      case "pdf":
        return style.getPropertyValue("--wk-color-danger").trim() || "#EF4444";
      case "doc":
      case "docx":
        return style.getPropertyValue("--wk-color-info").trim() || "#3B82F6";
      case "xls":
      case "xlsx":
        return style.getPropertyValue("--wk-color-success").trim() || "#22C55E";
      case "ppt":
      case "pptx":
        return style.getPropertyValue("--wk-color-warning").trim() || "#F97316";
      case "zip":
      case "rar":
      case "7z":
        return style.getPropertyValue("--wk-color-caution").trim() || "#EAB308";
      default:
        return style.getPropertyValue("--wk-text-tertiary").trim() || "#9CA3AF";
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  getMsgContent(msg: Message) {
    if (msg.contentType === MessageContentType.text) {
      const text = (msg.content as MessageText).text ?? "";
      return <MarkdownContent content={text} isSend={false} />;
    }
    if (msg.contentType === MessageContentType.image) {
      const imageContent = msg.content as ImageContent;
      const size = this.imageScale(imageContent.width, imageContent.height);
      const src = this.getImageSrc(imageContent) || "";

      return (
        <img
          style={{
            width: `${size.width}px`,
            height: `${size.height}px`,
            borderRadius: "var(--wk-r-xs, 4px)",
            cursor: "pointer",
          }}
          src={src}
          onClick={() =>
            this.setState({
              previewImgSrc: src,
              previewImageContent: imageContent,
            })
          }
        />
      );
    }
    if (msg.contentType === MessageContentTypeConst.mergeForward) {
      const nestedContent = msg.content as MergeforwardContent;
      const title = this.getTitle(nestedContent);
      // 从 nestedContent.users 构建 uid→name 映射，避免显示 raw UID
      const userNameMap = new Map<string, string>();
      (nestedContent.users || []).forEach((u) => {
        if (u && u.uid && u.name) userNameMap.set(u.uid, u.name);
      });
      const previewMsgs = (nestedContent.msgs || []).slice(0, 4).map((m) => {
        const name = userNameMap.get(m.fromUID)
          || WKSDK.shared().channelManager.getChannelInfo(new Channel(m.fromUID, ChannelTypePerson))?.title
          || m.content?.conversationDigest || "";
        return {
          fromUID: m.fromUID,
          digest: name ? `${name}: ${m.content?.conversationDigest || ""}` : (m.content?.conversationDigest || ""),
        };
      });
      return (
        <MergeforwardCard
          title={title}
          previewMsgs={previewMsgs}
          onClick={() => this.setState((prev) => {
            if (prev.contentStack.length >= 10) return null;
            return { contentStack: [...prev.contentStack, nestedContent] };
          })}
        />
      );
    }
    if (msg.contentType === MessageContentTypeConst.file) {
      const fileContent = msg.content as FileContent;
      const url = this.getFileURL(fileContent);
      const ext = (fileContent.extension || "").toUpperCase();
      const iconBg = this.getFileExtColor(fileContent.extension);
      return (
        <div
          className={`wk-mergeforward-file${
            url ? " wk-mergeforward-file--clickable" : ""
          }`}
          onClick={async () => {
            if (!url) return;
            await downloadFile(url, fileContent.name || "file");
          }}
        >
          <div
            className="wk-mergeforward-file__icon"
            style={{ backgroundColor: iconBg }}
          >
            <span className="wk-mergeforward-file__icon-label">
              {ext || "FILE"}
            </span>
          </div>
          <div className="wk-mergeforward-file__info">
            <div
              className="wk-mergeforward-file__name"
              title={fileContent.name}
            >
              {fileContent.name || "unknown file"}
            </div>
            <div className="wk-mergeforward-file__size">
              {this.formatFileSize(fileContent.size)}
            </div>
          </div>
        </div>
      );
    }
    return msg.content.conversationDigest;
  }

  render(): ReactNode {
    const { mergeforwardContent } = this.props;
    const { previewImgSrc, previewImageContent, contentStack } = this.state;

    // 当前显示的内容：栈顶 > props 传入的根内容
    const currentContent = contentStack.length > 0
      ? contentStack[contentStack.length - 1]
      : mergeforwardContent;

    // 按 uid 建立外部来源映射，渲染时 O(1) 查询
    const externalByUid = new Map<
      string,
      { is_external?: number; source_space_name?: string }
    >();
    (currentContent.users || []).forEach((u) => {
      if (u && u.uid) {
        externalByUid.set(u.uid, {
          is_external: u.is_external,
          source_space_name: u.source_space_name,
        });
      }
    });
    return (
      <>
        <div className="wk-mergeforwardmessagelist">
          {/* Content：消息列表，key 随栈深度变化强制重建 DOM 避免跨层复用 */}
          <div className="wk-mergeforwardmessagelist-content" key={`stack-${contentStack.length}`}>
            {currentContent.msgs.map((m, i) => {
              const fromChannel = new Channel(m.fromUID, ChannelTypePerson);
              let fromChannelInfo =
                WKSDK.shared().channelManager.getChannelInfo(fromChannel);
              if (!fromChannelInfo) {
                WKSDK.shared().channelManager.fetchChannelInfo(fromChannel);
              }
              const showAvatar =
                i === 0 ||
                currentContent.msgs[i - 1].fromUID !== m.fromUID;
              const extInfo = externalByUid.get(m.fromUID);
              const showExtOrigin =
                !!extInfo &&
                extInfo.is_external === 1 &&
                !!extInfo.source_space_name;
              return (
                <div
                  className="wk-mergeforwardmessagelist-content-msg"
                  key={m.messageID && m.messageID !== "undefined" ? m.messageID : `${m.fromUID}-${m.timestamp}-${i}`}
                >
                  {/* 头像 32x32 圆形，连续消息占位 */}
                  <div
                    className={
                      showAvatar
                        ? "wk-mergeforwardmessagelist-content-msg-avatar"
                        : "wk-mergeforwardmessagelist-content-msg-avatar--placeholder"
                    }
                  >
                    {showAvatar && (
                      <WKAvatar
                        channel={new Channel(m.fromUID, ChannelTypePerson)}
                      />
                    )}
                  </div>

                  <div className="wk-mergeforwardmessagelist-content-msg-info">
                    {/* 名字 + 时间（仅首条或换人时显示） */}
                    {showAvatar && (
                      <div className="wk-mergeforwardmessagelist-content-msg-info-first">
                        <span className="wk-mergeforwardmessagelist-content-msg-info-first-name">
                          {fromChannelInfo?.title}
                          {isBot(m.fromUID) && <AiBadge size="small" />}
                        </span>
                        <span className="wk-mergeforwardmessagelist-content-msg-info-first-time">
                          {getTimeStringAutoShort2(m.timestamp * 1000, true)}
                        </span>
                      </div>
                    )}
                    {/* 外部来源 */}
                    {showAvatar && showExtOrigin && (
                      <span className="ext-origin wk-mergeforwardmessagelist-content-msg-info-origin">
                        来源: {extInfo!.source_space_name}
                      </span>
                    )}

                    {/* 消息内容 */}
                    <div className="wk-mergeforwardmessagelist-content-msg-info-second-msgcontent">
                      {this.getMsgContent(m)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <Lightbox
          open={!!previewImgSrc}
          close={() =>
            this.setState({ previewImgSrc: null, previewImageContent: null })
          }
          slides={previewImgSrc ? [{ src: previewImgSrc, alt: "" }] : []}
          plugins={[Download]}
          download={{
            download: ({ slide }) => {
              if (slide?.src) {
                const name = previewImageContent?.name || "image.png";
                downloadFile(slide.src, name);
              }
            },
          }}
          carousel={{ finite: true }}
          controller={{ closeOnBackdropClick: true }}
          render={{
            buttonPrev: () => null,
            buttonNext: () => null,
          }}
        />
      </>
    );
  }
}
