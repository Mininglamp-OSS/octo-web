import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  ConversationAction,
  WKSDK,
  Mention,
  Message,
  MessageContent,
  Reminder,
  ReminderType,
  Reply,
  MessageText,
  MessageContentType,
  MediaMessageContent,
  TaskStatus,
  MessageTask,
} from "wukongimjssdk";
import React, { Component, HTMLProps } from "react";
import Provider from "../../Service/Provider";
import ConversationVM from "./vm";
import "./index.css";
import { EmojiInfo, MentionInfo } from "../../Messages/Text/MarkdownContent";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
import { MessageWrap, Part, PartType } from "../../Service/Model";
import WKApp from "../../App";
import { RevokeCell } from "../../Messages/Revoke";
import { MessageContentTypeConst } from "../../Service/Const";
import ConversationContext from "./context";
import MessageInput, {
  MentionModel,
  MessageInputContext,
} from "../MessageInput";
import { BotCommand } from "../SlashCommandMenu";
import ContextMenus, { ContextMenusContext } from "../ContextMenus";
import classNames from "classnames";
import WKAvatar from "../WKAvatar";
import AiBadge from "../AiBadge";
import { IconClose, IconEdit, IconReply } from "@douyinfe/semi-icons";
import { Toast, Spin } from "@douyinfe/semi-ui";
import { FlameMessageCell } from "../../Messages/Flame";
import FoldSessionCard, { FoldSessionCardParticipant } from "./FoldSessionCard";
import { BeatLoader } from "react-spinners";
import { ConversationRenderItem, FoldSessionViewModel } from "./vm";
import {
  getFoldSessionSummaryState,
  isFoldSessionSummaryMessage,
} from "./foldSessionSummary";
import {
  shouldPulldownOnWheel,
  TOP_HISTORY_TRIGGER_OFFSET,
} from "./historyScroll";
import {
  FileContent,
  formatFileSize,
  getFileIconInfo,
} from "../../Messages/File";
import { ImageContent } from "../../Messages/Image";
import { downloadFile } from "../../Utils/download";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import { buildChatContext, ChatContextChannelInfo } from "./chatContext";
import FoldSessionExpandedList from "./FoldSessionExpandedList";

const foldSessionAvatarIcon = new URL(
  "./fold-session-avatar.svg",
  import.meta.url
).href;

const FoldImage: React.FC<{ src: string }> = ({ src }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="wk-fold-img" onClick={() => setOpen(true)}>
      <img src={src} alt="" />
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src, alt: "", download: src }]}
        plugins={[Download]}
        carousel={{ finite: true }}
        controller={{ closeOnBackdropClick: true }}
        render={{ buttonPrev: () => null, buttonNext: () => null }}
      />
    </div>
  );
};

export interface ConversationProps {
  channel: Channel;
  chatBg?: string; // 聊天背景
  shouldShowHistorySplit?: boolean;
  initLocateMessageSeq?: number;
  onContext?: (ctx: ConversationContext) => void;
  onOpenThreadPanel?: (threadChannelId: string, threadName: string) => void;
  onSelectionStateChange?: (state: {
    editOn: boolean;
    checkedCount: number;
  }) => void;
}

const ConversationSelectionStateBridge: React.FC<{
  editOn: boolean;
  checkedCount: number;
  onChange?: (state: { editOn: boolean; checkedCount: number }) => void;
}> = ({ editOn, checkedCount, onChange }) => {
  React.useEffect(() => {
    if (onChange) {
      onChange({ editOn, checkedCount });
    }
  }, [checkedCount, editOn]);
  return null;
};

export class Conversation
  extends Component<ConversationProps>
  implements ConversationContext
{
  // 缓存各会话的引用/回复状态，切换会话时保留
  private static replyStateCache: Map<
    string,
    { message: Message; handlerType: number }
  > = new Map();
  private static readonly REPLY_STATE_CACHE_MAX_SIZE = 50;
  vm!: ConversationVM;
  contextMenusContext!: ContextMenusContext;
  avatarMenusContext!: ContextMenusContext; // 点击头像弹出的菜单
  _messageInputContext!: MessageInputContext;
  private _pendingInsertText?: string;
  scrollTimer: number | null = null;
  updateBrowseToMessageSeqAndReminderDoneing: boolean = false;
  private _dragFileCallback?: (file: File) => void;
  private _cachedSelectedText: string | null = null;
  private _beforeUnloadHandler: () => void;
  private _guardId: symbol = Symbol("pendingAttachmentGuard");
  private _addAttachmentFn?: (files: File[]) => void;
  private onOpenThreadPanel?: (
    threadChannelId: string,
    threadName: string
  ) => void;

  constructor(props: any) {
    super(props);
    this.state = {
      inputExpanded: false,
    };
    this.onOpenThreadPanel = props.onOpenThreadPanel;
    this._beforeUnloadHandler = () => {
      // Use sendBeacon for reliable delivery during page unload
      if (this.vm && this.vm.needSetUnread) {
        const apiURL = WKApp.apiClient.config.apiURL;
        const url = `${apiURL}conversation/clearUnread`;
        const data = JSON.stringify({
          channel_id: this.props.channel.channelID,
          channel_type: this.props.channel.channelType,
          unread: this.vm.unreadCount > 0 ? this.vm.unreadCount : 0,
        });
        const token = WKApp.loginInfo.token || "";
        fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", token: token },
          body: data,
          keepalive: true,
        });
      }
      this.dealloc();
    };
  }

  async sendMessage(
    content: MessageContent,
    channel?: Channel
  ): Promise<Message> {
    // const { channel } = this.props
    let c = channel;
    if (!c) {
      c = this.props.channel;
    }
    const message = await this.vm.sendMessage(content, c);
    return message;
  }

  fowardMessageUI(message: Message): void {
    WKApp.shared.baseContext.showConversationSelect((channels: Channel[]) => {
      let cloneContent = message.content; // TODO:这里理论上需要clone一份 但是不clone也没发现问题
      for (const channel of channels) {
        this.sendMessage(cloneContent, channel);
      }
    });
  }
  openThreadPanel(threadChannelId: string, threadName: string): void {
    this.onOpenThreadPanel?.(threadChannelId, threadName);
  }
  async resendMessage(message: Message): Promise<Message> {
    await this.vm.deleteMessagesFromLocal([message]);
    const newMessage = await this.vm.sendMessage(
      message.content,
      message.channel
    );
    return newMessage;
  }

  /**
   * 发送媒体消息并等待上传完成后才返回，保证多附件严格顺序发送。
   * 普通文字消息直接 sendMessage 返回。
   * 超时 30s 自动 resolve（避免网络断开时永久阻塞）。
   */
  private async sendMediaAndWait(
    content: MessageContent,
    channel?: Channel
  ): Promise<void> {
    const message = await this.sendMessage(content, channel);

    // 非媒体消息（或无文件需上传）无需等待
    if (
      !(content instanceof MediaMessageContent) ||
      !(content as MediaMessageContent).file
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      const TIMEOUT = 30_000;
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        WKSDK.shared().taskManager.removeListener(listener);
        clearTimeout(timer);
        resolve();
      };

      // 超时兜底：30s 后强制 resolve，不阻塞后续附件
      // ⚠️ 注意：WKSDK 的 BaseTask.cancel() 是空实现，超时后上传仍在后台继续。
      // 若超时触发，下一条附件会立即开始上传，两者并发，顺序无法保证。
      // 30s 是网络极差时的最后防线，正常情况下 task.success/fail 会在此之前触发。
      const timer = setTimeout(done, TIMEOUT);

      const listener = (task: any) => {
        if (
          task instanceof MessageTask &&
          task.message.clientSeq === message.clientSeq &&
          (task.status === TaskStatus.success ||
            task.status === TaskStatus.fail)
        ) {
          done();
        }
      };
      WKSDK.shared().taskManager.addListener(listener);
    });
  }
  scrollToBottom(animate?: boolean): void {
    this.vm.scrollToBottom(animate || false);
  }
  insertText(text: string): void {
    const ctx = this.messageInputContext();
    if (ctx) {
      ctx.insertText(text);
    } else {
      // MessageInput 的 useEffect 尚未执行，延迟重试
      this._pendingInsertText = text;
    }
  }
  editOn(): boolean {
    return this.vm.editOn;
  }
  setEditOn(edit: boolean): void {
    this.vm.editOn = edit;
    if (this.vm.selectMessage && edit) {
      this.vm.checkedMessage(this.vm.selectMessage, true);
    }
  }
  getCheckedMessageCount(): number {
    return this.vm.getCheckedMessages().length;
  }
  clearCheckedMessages(): void {
    this.vm.unCheckAllMessages();
  }
  checkeMessage(message: Message, checked: boolean): void {
    this.vm.checkedMessage(message, checked);
  }
  deleteMessages(messages: Message[]): void {
    this.vm.deleteMessages(messages);
  }
  revokeMessage(message: Message): Promise<void> {
    return this.vm.revokeMessage(message);
  }
  editMessage(
    messageID: String,
    messageSeq: number,
    channelID: String,
    channelType: number,
    content: String
  ): Promise<void> {
    return this.vm.editMessage(
      messageID,
      messageSeq,
      channelID,
      channelType,
      content
    );
  }
  onTapAvatar(uid: string, event: React.MouseEvent<Element, MouseEvent>): void {
    this.vm.selectUID = uid;
    this.avatarMenusContext.show(event);
  }

  // 定位消息
  locateMessage(messageSeq: number) {
    const messageWrap = this.vm.findMessageWithMessageSeq(messageSeq);
    if (messageWrap) {
      const foldSession = this.vm.findFoldSessionByMessageSeq(messageSeq);
      if (foldSession) {
        const isSummaryMessage = isFoldSessionSummaryMessage(
          foldSession,
          messageSeq
        );
        if (isSummaryMessage) {
          this.vm.highlightFoldSessionSummary(foldSession.sessionId, () => {
            this.vm.scrollToFoldSession(foldSession.sessionId);
          });
          return;
        }
        this.vm.setFoldSessionExpanded(
          foldSession.sessionId,
          true,
          false,
          () => {
            messageWrap.locateRemind = true;
            this.vm.scrollToMessage(messageWrap);
            this.vm.notifyListener();
          }
        );
        return;
      }
      this.vm.scrollToMessage(messageWrap);
      messageWrap.locateRemind = true;
      this.vm.notifyListener();
      return;
    }
    this.vm.requestMessagesOfFirstPage(messageSeq, () => {
      if (this.vm.findMessageWithMessageSeq(messageSeq)) {
        this.locateMessage(messageSeq);
      }
    });
  }

  // 显示用户信息
  showUser(uid: string) {
    let fromChannel: Channel | undefined;
    let vercode: string | undefined;
    if (this.vm.channel.channelType === ChannelTypeGroup) {
      fromChannel = this.vm.channel;
      const subscriber = this.vm.subscriberWithUID(uid);
      if (subscriber?.orgData?.vercode) {
        vercode = subscriber?.orgData?.vercode;
      }
    }
    WKApp.shared.baseContext.showUserInfo(uid, fromChannel, vercode);
  }

  // 回复消息
  reply(message: Message, handlerType: number): void {
    if (message.fromUID !== WKApp.loginInfo.uid) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
        new Channel(message.fromUID, ChannelTypePerson)
      );
      let name = "";
      if (channelInfo) {
        name = channelInfo.title;
      }
      this._messageInputContext?.addMention(message.fromUID, name);
    }
    if (handlerType === 2) {
      let content = message.remoteExtra?.isEdit
        ? message.remoteExtra?.contentEdit?.conversationDigest
        : message.content.conversationDigest;
      this.insertText(content);
    }
    this.vm.currentHandlerType = handlerType;
    this.vm.currentReplyMessage = message;
  }

  setDragFileCallback(f: (file: File) => void): void {
    this._dragFileCallback = f;
  }

  // ── Attachment Queue (#143 / #144) ──────────────────────────────────────

  getPendingAttachments(): File[] {
    // 从编辑器中获取附件文件
    return this._messageInputContext?.getAttachmentFiles() || [];
  }

  addPendingAttachments(files: File[]): string | null {
    const BLOCKED_EXTENSIONS = [
      "exe",
      "bat",
      "sh",
      "cmd",
      "msi",
      "dll",
      "php",
      "jsp",
      "apk",
      "com",
      "scr",
      "pif",
      "vbs",
      "js",
      "wsf",
      "ps1",
    ];
    const incoming = Array.from(files);

    // 检查类型黑名单
    for (const f of incoming) {
      const ext = f.name.substring(f.name.lastIndexOf(".") + 1).toLowerCase();
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        return `不允许发送 .${ext} 类型的文件`;
      }
    }

    // 调用编辑器的 addAttachment 方法插入附件节点
    if (this._addAttachmentFn) {
      this._addAttachmentFn(incoming);
    }
    return null;
  }

  removePendingAttachment(_index: number): void {
    // 附件现在由编辑器管理，通过编辑器节点删除
    // 此方法保留以兼容接口，但不再需要手动调用
  }

  clearPendingAttachments(): void {
    // 附件现在由编辑器管理，清空编辑器内容时会自动清除
    // 此方法保留以兼容接口
  }

  channel(): Channel {
    return this.vm.channel;
  }

  // 显示消息上下文菜单
  showContextMenus(message: Message, event: React.MouseEvent) {
    this.vm.selectMessage = message;

    // 缓存当前选区文本（仅当选区完全在当前消息气泡内时）
    this._cachedSelectedText = null;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const text = selection.toString();
      if (text.length > 0) {
        const range = selection.getRangeAt(0);
        const target = event.target as HTMLElement;
        const bubble = target.closest(".wk-message-base-bubble");
        if (bubble && bubble.contains(range.commonAncestorContainer)) {
          this._cachedSelectedText = text;
        }
      }
    }

    this.contextMenusContext.show(event);
  }
  hideContextMenus(): void {
    this.contextMenusContext.hide();
  }

  getCachedSelectedText(): string | null {
    return this._cachedSelectedText;
  }

  messageInputContext(): MessageInputContext | undefined {
    return this._messageInputContext;
  }

  forceStandaloneMessage(message: Message): boolean {
    // 紧跟在折叠卡片后的消息，强制独立（避免 preMessage 仍指向卡片内消息导致头像丢失）
    if (this.vm.afterFoldSessionClientMsgNos.has(message.clientMsgNo)) {
      return true;
    }

    const foldSession =
      message.messageSeq > 0
        ? this.vm.findFoldSessionByMessageSeq(message.messageSeq)
        : undefined;
    if (foldSession?.isExpanded) {
      return foldSession.expandedMessages.some(
        (expandedMessage) => expandedMessage.clientMsgNo === message.clientMsgNo
      );
    }
    for (const item of this.vm.renderItems) {
      if (item.type !== "foldSession" || !item.session.isExpanded) {
        continue;
      }
      if (
        item.session.expandedMessages.some(
          (expandedMessage) =>
            expandedMessage.clientMsgNo === message.clientMsgNo
        )
      ) {
        return true;
      }
    }
    return false;
  }

  componentDidMount() {
    const { channel, onContext } = this.props;
    if (onContext) {
      onContext(this);
    }
    WKApp.shared.openChannel = channel;

    // 注册附件发送守卫：返回 false 表示有未发送附件，需弹确认
    WKApp.shared.pendingAttachmentGuard = () =>
      this.getPendingAttachments().length === 0;
    WKApp.shared.pendingAttachmentGuardId = this._guardId;

    if (this.vm.hasDraft()) {
      this.insertText(this.vm.draft());
    }
    // 恢复引用/回复状态
    const channelKey = `${channel.channelID}-${channel.channelType}`;
    const cachedReplyState = Conversation.replyStateCache.get(channelKey);
    if (cachedReplyState) {
      this.vm.currentReplyMessage = cachedReplyState.message;
      this.vm.currentHandlerType = cachedReplyState.handlerType;
      Conversation.replyStateCache.delete(channelKey);
    }

    window.addEventListener("beforeunload", this._beforeUnloadHandler);

    this.vm.onFirstMessagesLoaded = () => {
      this.updateBrowseToMessageSeqAndReminderDoneIfNeed();

      this.uploadReadedIfNeed();
    };

    this.vm.markUnread();
  }

  componentWillUnmount() {
    window.removeEventListener("beforeunload", this._beforeUnloadHandler);
    // 注销附件守卫：只清除自己注册的，防止新实例 guard 被旧实例 unmount 覆盖
    if (WKApp.shared.pendingAttachmentGuardId === this._guardId) {
      WKApp.shared.pendingAttachmentGuard = undefined;
      WKApp.shared.pendingAttachmentGuardId = undefined;
    }
    // 附件现在由编辑器管理，组件卸载时编辑器会自动清理
    this.dealloc();
  }
  dealloc() {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    // 保存引用/回复状态到缓存
    const channelKey = `${this.props.channel.channelID}-${this.props.channel.channelType}`;
    if (this.vm.currentReplyMessage) {
      Conversation.replyStateCache.set(channelKey, {
        message: this.vm.currentReplyMessage,
        handlerType: this.vm.currentHandlerType,
      });
      // Evict oldest entries when cache exceeds max size
      if (
        Conversation.replyStateCache.size >
        Conversation.REPLY_STATE_CACHE_MAX_SIZE
      ) {
        const firstKey = Conversation.replyStateCache.keys().next().value;
        if (firstKey !== undefined) {
          Conversation.replyStateCache.delete(firstKey);
        }
      }
    } else {
      Conversation.replyStateCache.delete(channelKey);
    }
    this.vm.markUnread();
    this.markConversationExtra();
    WKApp.shared.openChannel = undefined;
    WKSDK.shared().conversationManager.openConversation = undefined;
  }

  markConversationExtra() {
    let draft = this.messageInputContext()?.text();
    const conversationLastMessageSeq = this.vm.conversationLastMessageSeq();
    const lastVisiableMessage = this.lastVisiableMessage(null);
    let keepMessageSeq = 0;
    if (
      lastVisiableMessage &&
      lastVisiableMessage.messageSeq >= conversationLastMessageSeq
    ) {
      keepMessageSeq = 0;
    } else {
      const firstVisiableMessage = this.firstVisiableMessage(null);
      keepMessageSeq = firstVisiableMessage?.messageSeq || 0;
    }

    WKApp.dataSource.channelDataSource.conversationExtraUpdate({
      channel: this.vm.channel,
      browseTo: 0,
      keepMessageSeq: keepMessageSeq,
      keepOffsetY: 0,
      draft: draft || "",
      version: 0,
    });
  }

  _handleContextMenus(event: React.MouseEvent) {
    this.contextMenusContext.show(event);
  }

  getMessageElement(message: Message | MessageWrap) {
    const element = document.getElementById(message.clientMsgNo);
    if (element) {
      return element;
    }
    if (!message.messageSeq || message.messageSeq <= 0) {
      return null;
    }
    const foldSession = this.vm.findFoldSessionByMessageSeq(message.messageSeq);
    if (!foldSession) {
      return null;
    }
    return document.getElementById(foldSession.anchorId);
  }

  getMessageMentions(message: MessageWrap): MentionInfo[] {
    return (
      message.parts
        ?.filter(
          (part: Part) => part.type === PartType.mention && part.data?.uid
        )
        .map((part: Part) => ({ name: part.text, uid: part.data.uid })) ?? []
    );
  }

  getMessageEmojis(message: MessageWrap): EmojiInfo[] {
    return (
      message.parts
        ?.filter((part: Part) => part.type === PartType.emoji)
        .reduce((acc: EmojiInfo[], part: Part) => {
          const url = WKApp.emojiService.getImage(part.text);
          if (url && !acc.find((emoji) => emoji.key === part.text)) {
            acc.push({ key: part.text, url });
          }
          return acc;
        }, []) ?? []
    );
  }

  getMessageTextContent(message: MessageWrap) {
    if (message.streamOn) {
      return message.fullStreamContent;
    }
    const rawContent = message.remoteExtra?.isEdit
      ? (message.remoteExtra?.contentEdit as any)
      : (message.content as any);
    return (
      rawContent?.text ||
      message.parts?.map((part: Part) => part.text).join("") ||
      ""
    );
  }

  renderFoldSessionSummary(message: MessageWrap) {
    if (message.contentType === MessageContentTypeConst.typing) {
      return (
        <span className="wk-fold-session-summary-loading">
          <BeatLoader size={8} margin={4} color="var(--wk-color-theme)" />
        </span>
      );
    }
    if (message.contentType === MessageContentType.text || message.streamOn) {
      return (
        <MarkdownContent
          content={this.getMessageTextContent(message)}
          isSend={message.send}
          isStreaming={message.isStreaming}
          mentions={this.getMessageMentions(message)}
          onMentionClick={(uid) => this.showUser(uid)}
          emojis={this.getMessageEmojis(message)}
        />
      );
    }
    const digest = message.remoteExtra?.isEdit
      ? message.remoteExtra?.contentEdit?.conversationDigest
      : message.content?.conversationDigest;
    return digest || "";
  }

  renderFoldSessionExpandedList(messages: MessageWrap[]) {
    const editMode = this.vm.editOn;
    return (
      <FoldSessionExpandedList
        messages={messages}
        editMode={editMode}
        renderAvatar={(message) => (
          <WKAvatar
            channel={new Channel(message.fromUID, ChannelTypePerson)}
            style={{ width: "100%", height: "100%" }}
          />
        )}
        renderMessageContent={(message) =>
          this.renderFoldMessageContent(message)
        }
        onToggleSelect={(message, checked) => {
          this.vm.checkedMessage(message, checked);
        }}
        onMessageContextMenu={(message, event) => {
          this.showContextMenus(message, event);
        }}
      />
    );
  }

  renderFoldMessageContent(message: MessageWrap) {
    // 文本消息（含 Markdown 表格、代码块、链接）
    if (message.contentType === MessageContentType.text || message.streamOn) {
      return (
        <div className="wk-fold-msg-text">
          <MarkdownContent
            content={this.getMessageTextContent(message)}
            isSend={message.send}
            isStreaming={message.isStreaming}
            mentions={this.getMessageMentions(message)}
            onMentionClick={(uid) => this.showUser(uid)}
            emojis={this.getMessageEmojis(message)}
          />
        </div>
      );
    }

    // 文件消息
    if (message.contentType === MessageContentTypeConst.file) {
      const content = message.content as FileContent;
      const iconInfo = getFileIconInfo(content.extension, content.name);
      return (
        <div
          className="wk-fold-file"
          onClick={async () => {
            const rawUrl = content.url || content.remoteUrl || "";
            if (!rawUrl) return;
            const fileUrl =
              WKApp.dataSource.commonDataSource.getFileURL(rawUrl);
            if (!fileUrl) return;
            await downloadFile(fileUrl, content.name || "file");
          }}
        >
          <div
            className="wk-fold-file-icon"
            style={{ backgroundColor: iconInfo.color }}
          >
            <span>{iconInfo.label}</span>
          </div>
          <div className="wk-fold-file-info">
            <div className="wk-fold-file-name" title={content.name}>
              {content.name || "未知文件"}
            </div>
            <div className="wk-fold-file-size">
              {formatFileSize(content.size)}
            </div>
          </div>
          <div className="wk-fold-file-dl" title="下载">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        </div>
      );
    }

    // 图片消息
    if (message.contentType === MessageContentType.image) {
      const content = message.content as ImageContent;
      const rawUrl = content.url || content.remoteUrl || "";
      const imgUrl = rawUrl
        ? WKApp.dataSource.commonDataSource.getImageURL(rawUrl)
        : content.imgData || "";
      return imgUrl ? <FoldImage src={imgUrl} /> : null;
    }

    // 其他类型：回退到文本摘要
    const digest = this.getMessageDigestText(message);
    return <div className="wk-fold-msg-text">{digest}</div>;
  }

  getMessageDigestText(message: MessageWrap): string {
    if (message.streamOn) {
      return message.fullStreamContent || "";
    }
    const rawContent = message.remoteExtra?.isEdit
      ? (message.remoteExtra?.contentEdit as any)
      : (message.content as any);
    return (
      rawContent?.text ||
      rawContent?.conversationDigest ||
      message.parts?.map((part: Part) => part.text).join("") ||
      ""
    );
  }

  foldSessionUI(session: FoldSessionViewModel, last: boolean) {
    const participants: FoldSessionCardParticipant[] = session.participants.map(
      (participant) => ({
        id: participant.uid,
        name: participant.name,
        avatar: (
          <WKAvatar
            channel={participant.channel}
            style={{ width: "100%", height: "100%" }}
          />
        ),
      })
    );
    const { showSummary, summaryId, summaryMessage } =
      getFoldSessionSummaryState(session);
    const summarySelectable =
      showSummary &&
      summaryMessage.contentType !== MessageContentTypeConst.typing;
    const typingSender =
      summaryMessage.contentType === MessageContentTypeConst.typing
        ? (summaryMessage.content as { fromName?: string })?.fromName
        : undefined;
    const summarySender =
      summaryMessage.from?.title || typingSender || summaryMessage.fromUID;

    return (
      <div
        key={session.sessionId}
        id={session.anchorId}
        className={classNames(
          "wk-message-item",
          "wk-message-item-fold-session",
          last ? "wk-message-item-last" : undefined
        )}
      >
        <div className="wk-message-item-fold-session-shell">
          <div
            className="wk-message-item-fold-session-avatar"
            aria-hidden="true"
          >
            <img
              className="wk-message-item-fold-session-avatar-icon"
              src={foldSessionAvatarIcon}
              alt=""
            />
          </div>
          <FoldSessionCard
            className="wk-message-item-fold-session-card"
            participants={participants}
            count={session.count}
            selectionMode={this.vm.editOn}
            isActive={session.isActive}
            isExpanded={session.isExpanded}
            appearing={session.shouldAppear}
            flash={session.shouldMergeFlash}
            showSummary={showSummary}
            highlightSummary={session.highlightSummary}
            summaryId={summaryId}
            summarySender={summarySender}
            summaryContent={this.renderFoldSessionSummary(summaryMessage)}
            expandedContent={this.renderFoldSessionExpandedList(
              session.expandedMessages
            )}
            onToggle={() => {
              this.vm.toggleFoldSession(session.sessionId);
            }}
            summaryChecked={!!summaryMessage.checked}
            summarySelectable={summarySelectable}
            onSummaryToggleSelect={(checked) => {
              if (!summarySelectable) {
                return;
              }
              this.vm.checkedMessage(summaryMessage.message, checked);
            }}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                if (
                  event.animationName === "wk-fold-session-appear" &&
                  session.shouldMergeFlash
                ) {
                  return;
                }
                this.vm.clearFoldSessionAnimation(session.sessionId);
              }
            }}
            onSummaryContextMenu={
              summaryMessage.contentType !== MessageContentTypeConst.typing
                ? (event) => {
                    this.showContextMenus(summaryMessage.message, event);
                  }
                : undefined
            }
            onSummaryAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                this.vm.clearFoldSessionSummaryHighlight(session.sessionId);
              }
            }}
          />
        </div>
      </div>
    );
  }

  renderConversationItem(item: ConversationRenderItem, last: boolean) {
    if (item.type === "foldSession") {
      return this.foldSessionUI(item.session, last);
    }
    return this.messageUI(item.message, last);
  }

  messageUI(message: MessageWrap, last: boolean, extraClassName?: string) {
    let MessageCell: React.ElementType | undefined;
    if (message.revoke) {
      MessageCell = RevokeCell;
    } else if (message.flame) {
      MessageCell = FlameMessageCell;
    } else {
      MessageCell = WKApp.messageManager.getCell(message.contentType);
    }
    const isSystemMessage =
      message.revoke ||
      message.contentType === MessageContentTypeConst.screenshot ||
      (message.contentType >= 1000 && message.contentType <= 2000);
    return (
      <div
        onAnimationEnd={() => {
          message.locateRemind = false;
          this.setState({});
        }}
        key={message.clientMsgNo}
        id={`${
          message.contentType === MessageContentTypeConst.time ? "time-" : ""
        }${message.clientMsgNo}`}
        className={classNames(
          "wk-message-item",
          extraClassName,
          last ? "wk-message-item-last" : undefined,
          message.locateRemind ? "wk-message-item-reminder" : undefined,
          isSystemMessage ? "wk-message-item-system" : undefined
        )}
      >
        {MessageCell ? (
          <MessageCell
            key={message.clientMsgNo}
            message={message}
            context={this}
          />
        ) : null}
      </div>
    );
  }

  handleScroll(e: any) {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.scrollTimer = window.setTimeout(() => {
      this.handleScrollEnd();
    }, 500);
    this.contextMenusContext.hide();
    const targetScrollTop = e.target.scrollTop;
    const scrollOffsetTop =
      e.target.scrollHeight - (targetScrollTop + e.target.clientHeight);
    if (
      targetScrollTop <= TOP_HISTORY_TRIGGER_OFFSET &&
      !this.vm.loading &&
      !this.vm.pulldownFinished
    ) {
      // 下拉
      this.vm.pulldownMessages();
    } else if (
      scrollOffsetTop <= 500 &&
      !this.vm.loading &&
      this.vm.pullupHasMore
    ) {
      // 上拉
      this.vm.pullupMessages();
    }
    if (this.vm.lastMessage) {
      this.vm.lastLocalMessageElement = this.getMessageElement(
        this.vm.lastMessage
      ); // 最新消息
      if (this.vm.lastLocalMessageElement) {
        // 如果有最新消息的dom则判断是否在可见范围内
        if (
          scrollOffsetTop >
          this.vm.lastLocalMessageElement.clientHeight + 20
        ) {
          // 如果滚动距离超过了第一个元素则显示“滚动到底部”
          this.vm.showScrollToBottomBtn = true;
        } else {
          this.vm.showScrollToBottomBtn = false;
        }
      } else {
        this.vm.showScrollToBottomBtn = true;
      }
    }

    this.updateBrowseToMessageSeqAndReminderDoneIfNeed();
  }

  // 内容不满屏时，wheel 向上滚动触发加载更多历史（折叠卡片压缩内容可能导致不满屏无法触发 onScroll）
  handleWheel(e: React.WheelEvent) {
    const viewport = e.currentTarget as HTMLElement;
    if (
      !this.vm.loading &&
      !this.vm.pulldownFinished &&
      shouldPulldownOnWheel(
        e.deltaY,
        viewport.scrollTop,
        this.isFullScreen(viewport)
      )
    ) {
      this.vm.pulldownMessages();
    }
  }

  // 判断内容是否满一屏幕
  isFullScreen(viewport: HTMLElement | null) {
    if (!viewport) {
      return false;
    }
    return viewport.scrollHeight > viewport.clientHeight;
  }

  handleScrollEnd() {
    this.uploadReadedIfNeed();
  }

  // 上传已读数据
  uploadReadedIfNeed() {
    const viewport = document.getElementById(this.vm.messageContainerId);
    const visiableMessages = this.allVisiableMessages(viewport);
    if (visiableMessages && visiableMessages.length > 0) {
      const unreadMessages = new Array<Message>();
      for (const visiableMessage of visiableMessages) {
        if (
          !visiableMessage.remoteExtra.readed &&
          visiableMessage.fromUID !== WKApp.loginInfo.uid &&
          visiableMessage.setting.receiptEnabled
        ) {
          unreadMessages.push(visiableMessage.message);
        }
      }
      WKSDK.shared().receiptManager.addReceiptMessages(
        this.channel(),
        unreadMessages
      );
    }
  }

  // 更新已读位置和提醒项
  updateBrowseToMessageSeqAndReminderDoneIfNeed() {
    const viewport = document.getElementById(this.vm.messageContainerId);

    this.updateBrowseToMessageSeq(viewport); // 更新已读位置

    this.updateReminderDoneIfNeed(viewport); // 更新提醒项
  }

  // 更新已预览的位置
  updateBrowseToMessageSeq(viewport: HTMLElement | null) {
    const lastVisiableMessage = this.lastVisiableMessage(viewport); // 当前UI显示的最后一条可见的消息
    if (
      lastVisiableMessage &&
      lastVisiableMessage.messageSeq > this.vm.browseToMessageSeq
    ) {
      // 如果当前UI显示的最后一条消息大于已预览到的最新消息，则更新未读数
      this.vm.browseToMessageSeq = lastVisiableMessage.messageSeq;
      this.vm.refreshNewMsgCount(); // 刷新最新消息数量
    }
  }

  // 更新提醒项
  updateReminderDoneIfNeed(viewport: HTMLElement | null) {
    if (!this.vm.messages || this.vm.messages.length === 0) {
      return;
    }

    const reminders = this.vm.currentConversation?.reminders;
    if (!reminders || reminders.length === 0) {
      return;
    }
    const doneReminderIDs: number[] = [];
    for (const reminder of reminders) {
      if (reminder.done) {
        continue;
      }
      const message = this.vm.findMessageWithMessageSeq(reminder.messageSeq);
      if (message && this.isVisiableMessage(message.message, viewport)) {
        doneReminderIDs.push(reminder.reminderID);
        continue;
      }
    }
    if (doneReminderIDs.length > 0) {
      // Persist reminder done status to server via SDK (fixes #169)
      WKSDK.shared().reminderManager.done(doneReminderIDs);
    }
  }

  // 消息是否可见
  isVisiableMessage(message: Message, viewport: HTMLElement | null) {
    if (!viewport) {
      return;
    }
    const targetScrollTop = viewport.scrollTop;
    const scrollOffsetTop =
      viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);

    const element = this.getMessageElement(message);
    if (element) {
      if (
        viewport.scrollHeight - element.offsetTop > scrollOffsetTop &&
        element.offsetTop + element.clientHeight > targetScrollTop
      ) {
        return true;
      }
    }
    return false;
  }
  // 获取最后一个可见的消息
  lastVisiableMessage(viewport: HTMLElement | null) {
    if (!this.vm.messages || this.vm.messages.length === 0) {
      return;
    }
    if (!viewport) {
      viewport = document.getElementById(this.vm.messageContainerId);
    }
    if (!viewport) {
      return;
    }
    const targetScrollTop = viewport.scrollTop;
    const scrollOffsetTop =
      viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);

    for (let index = this.vm.messages.length - 1; index >= 0; index--) {
      const message = this.vm.messages[index];
      const element = this.getMessageElement(message);
      if (element) {
        if (viewport.scrollHeight - element.offsetTop > scrollOffsetTop) {
          return message;
        }
      }
    }
  }

  // 获取第一个可见的消息
  firstVisiableMessage(vp: HTMLElement | null) {
    if (!this.vm.messages || this.vm.messages.length === 0) {
      return;
    }
    let viewport = vp;
    if (!viewport) {
      viewport = document.getElementById(this.vm.messageContainerId);
    }
    if (!viewport) {
      return;
    }
    const targetScrollTop = viewport.scrollTop;
    // const scrollOffsetTop = viewport.scrollHeight - (targetScrollTop + viewport.clientHeight);
    for (let index = 0; index < this.vm.messages.length; index++) {
      const message = this.vm.messages[index];
      const element = this.getMessageElement(message);
      if (element) {
        if (element.offsetTop + element.clientHeight > targetScrollTop) {
          return message;
        }
      }
    }
  }
  // 所有可见的消息
  allVisiableMessages(vp: HTMLElement | null): Array<MessageWrap> {
    const visiableMessages = new Array<MessageWrap>();
    if (!this.vm.messages || this.vm.messages.length === 0) {
      return visiableMessages;
    }
    let viewport = vp;
    if (!viewport) {
      viewport = document.getElementById(this.vm.messageContainerId);
    }
    if (!viewport) {
      return visiableMessages;
    }

    const targetScrollTop = viewport.scrollTop;
    for (let index = 0; index < this.vm.messages.length; index++) {
      const message = this.vm.messages[index];
      const element = this.getMessageElement(message);
      if (element) {
        if (element.offsetTop + element.clientHeight / 2 > targetScrollTop) {
          // message 要漏出来一半才算可见
          visiableMessages.push(message);
        }
      }
    }
    return visiableMessages;
  }

  chatToolbarUI() {
    const toolbars = WKApp.endpoints.chatToolbarsWithKey(this);
    return (
      <ul className="wk-conversation-chattoolbars">
        {toolbars.map((t) => {
          return (
            <li key={t.sid} className="wk-conversation-chattoolbars-item">
              {t.node}
            </li>
          );
        })}
      </ul>
    );
  }

  dragEnd() {
    this.vm.fileDragEnter = false;
    this.vm.fileDragLeave = true;
    this.vm.notifyListener();
  }
  dragStart() {
    this.vm.fileDragEnter = true;
    this.vm.fileDragLeave = false;
    this.vm.notifyListener();
  }

  render() {
    const { chatBg, channel, initLocateMessageSeq } = this.props;

    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);

    let botCommands: BotCommand[] | undefined;
    if (
      channel.channelType === ChannelTypePerson &&
      channelInfo?.orgData?.robot === 1 &&
      channelInfo.orgData.bot_commands
    ) {
      try {
        const raw =
          typeof channelInfo.orgData.bot_commands === "string"
            ? JSON.parse(channelInfo.orgData.bot_commands)
            : channelInfo.orgData.bot_commands;
        if (Array.isArray(raw)) {
          botCommands = raw as BotCommand[];
        }
      } catch (e) {
        // ignore invalid bot_commands JSON
      }
    }

    return (
      <Provider
        create={() => {
          this.vm = new ConversationVM(channel, initLocateMessageSeq);
          return this.vm;
        }}
        render={(vm: ConversationVM) => {
          return (
            <>
              <ConversationSelectionStateBridge
                editOn={vm.editOn}
                checkedCount={vm.getCheckedMessages().length}
                onChange={this.props.onSelectionStateChange}
              />
              <div
                className={classNames(
                  "wk-conversation",
                  vm.fileDragEnter ? "wk-conversation-dragover" : undefined,
                  vm.currentReplyMessage
                    ? "wk-conversation-hasreply"
                    : undefined
                )}
                style={{
                  background: chatBg
                    ? `url(${chatBg}) rgb(245, 247, 249)`
                    : undefined,
                }}
              >
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    this.dragStart();
                  }}
                  className={classNames("wk-conversation-content")}
                  style={
                    this.state.inputExpanded
                      ? { height: 0, overflow: "hidden", flex: "none" }
                      : undefined
                  }
                  {...(this.state.inputExpanded ? { inert: "" } : {})}
                >
                  <div
                    className="wk-conversation-messages"
                    id={vm.messageContainerId}
                    onScroll={this.handleScroll.bind(this)}
                    onWheel={this.handleWheel.bind(this)}
                  >
                    {vm.renderItems.map((item, i) => {
                      let last = false;
                      if (i === vm.renderItems.length - 1) {
                        last = true;
                      }
                      return this.renderConversationItem(item, last);
                    })}

                    {/* 位置view */}
                    <ConversationPositionView
                      onScrollToBottom={async () => {
                        return this.vm.onDownArrow();
                      }}
                      onReminder={(reminder) => {
                        return this.vm.syncMessages(reminder.messageSeq, () => {
                          this.locateMessage(reminder.messageSeq);
                        });
                      }}
                      showScrollToBottom={vm.showScrollToBottomBtn || false}
                      unreadCount={vm.unreadCount}
                      reminders={vm.currentConversation?.reminders?.filter(
                        (r) => !r.done
                      )}
                    ></ConversationPositionView>

                    {vm.fileDragEnter ? (
                      <div
                        className="wk-conversation-content-fileupload-mask"
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          this.dragEnd();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          this.dragEnd();
                          const files = Array.from(event.dataTransfer.files);
                          if (files.length === 0) return;
                          const err = this.addPendingAttachments(files);
                          if (err) Toast.error(err);
                        }}
                      >
                        <div className="wk-conversation-content-fileupload-mask-content">
                          发送给 &nbsp; {channelInfo?.title}
                        </div>
                      </div>
                    ) : undefined}
                  </div>
                </div>
                {/* ReplyView 已移到 MessageInput 内部的 topView prop */}
                <div className="wk-conversation-topview"></div>
                <div
                  className={classNames(
                    "wk-conversation-multiplepanel",
                    vm.editOn ? "wk-conversation-multiplepanel-show" : undefined
                  )}
                >
                  <MultiplePanel
                    onClose={() => {
                      vm.editOn = false;
                      vm.unCheckAllMessages();
                    }}
                    onForward={() => {
                      WKApp.shared.baseContext.showConversationSelect(
                        (channels: Channel[]) => {
                          const messages = vm.getCheckedMessages();
                          if (!messages || messages.length === 0) {
                            Toast.error("请先选择消息！");
                            return;
                          }
                          for (const message of messages) {
                            let cloneContent = message.content; // TODO:这里理论上需要clone一份 但是不clone也没发现问题
                            for (const channel of channels) {
                              this.sendMessage(cloneContent, channel);
                            }
                          }
                          vm.editOn = false;
                          vm.unCheckAllMessages();
                        }
                      );
                    }}
                    onMergeForward={() => {
                      WKApp.shared.baseContext.showConversationSelect(
                        (channels: Channel[]) => {
                          vm.sendMergeforward(channels);
                          vm.editOn = false;
                          vm.unCheckAllMessages();
                        }
                      );
                    }}
                    onDelete={async () => {
                      const checkedMessagewraps = vm.getCheckedMessages();
                      const checkedMessages = checkedMessagewraps.map((m) => {
                        return m.message;
                      });
                      await vm.deleteMessages(checkedMessages);

                      vm.editOn = false;
                      vm.unCheckAllMessages();
                    }}
                  ></MultiplePanel>
                </div>
                <div
                  className="wk-conversation-footer"
                  style={
                    this.state.inputExpanded
                      ? {
                          flex: 1,
                          minHeight: 0,
                          overflow: "hidden",
                          paddingTop: "var(--wk-sp-2)",
                        }
                      : undefined
                  }
                >
                  <div
                    className="wk-conversation-footer-content"
                    style={
                      this.state.inputExpanded
                        ? {
                            height: "100%",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                          }
                        : undefined
                    }
                  >
                    <MessageInput
                      botCommands={botCommands}
                      onAddAttachment={(addFn: (files: File[]) => void) => {
                        // 存储 addAttachment 方法，供外部调用
                        this._addAttachmentFn = addFn;
                      }}
                      members={this.vm.subscribers.filter(
                        (s) => s.uid !== WKApp.loginInfo.uid
                      )}
                      topView={
                        vm.currentReplyMessage ? (
                          <ReplyView
                            message={vm.currentReplyMessage}
                            vm={vm}
                            onClose={() => {
                              vm.currentReplyMessage = undefined;
                            }}
                          />
                        ) : undefined
                      }
                      onExpandChange={(expanded) => {
                        this.setState({ inputExpanded: expanded });
                      }}
                      onContext={(ctx) => {
                        this._messageInputContext = ctx;
                        // flush 延迟的 insertText（componentDidMount 时 context 可能还没就绪）
                        if (this._pendingInsertText) {
                          ctx.insertText(this._pendingInsertText);
                          this._pendingInsertText = undefined;
                        }
                      }}
                      toolbar={this.chatToolbarUI()}
                      context={this}
                      getChatContext={() => {
                        const { channel } = this.props;
                        return buildChatContext({
                          messages: this.vm.messagesOfOrigin || [],
                          subscribers: this.vm.subscribers,
                          channelType: channel.channelType,
                          loginUID: WKApp.loginInfo.uid,
                          channelInfo:
                            channel.channelType === ChannelTypePerson
                              ? (WKSDK.shared().channelManager.getChannelInfo(
                                  channel
                                ) as ChatContextChannelInfo | null)
                              : undefined,
                        });
                      }}
                      onSend={async (
                        text: string,
                        mention?: MentionModel,
                        attachments?: { id: string; file: File }[]
                      ) => {
                        const content = new MessageText(text);
                        if (mention) {
                          const mn = new Mention();
                          mn.all = mention.all;
                          mn.uids = mention.uids;
                          mn.entities = mention.entities;
                          content.mention = mn;
                        }
                        if (vm.currentReplyMessage) {
                          if (vm.currentHandlerType === 2) {
                            // 编辑消息
                            let json = content.encodeJSON();
                            json["type"] = MessageContentType.text;
                            await vm.editMessage(
                              vm.currentReplyMessage.messageID,
                              vm.currentReplyMessage.messageSeq,
                              vm.currentReplyMessage.channel.channelID,
                              vm.currentReplyMessage.channel.channelType,
                              JSON.stringify(json)
                            );
                            vm.currentReplyMessage = undefined;
                            return;
                          }
                          const reply = new Reply();
                          reply.messageID = vm.currentReplyMessage.messageID;
                          reply.messageSeq = vm.currentReplyMessage.messageSeq;
                          reply.fromUID = vm.currentReplyMessage.fromUID;
                          const channelInfo =
                            WKSDK.shared().channelManager.getChannelInfo(
                              new Channel(
                                vm.currentReplyMessage.fromUID,
                                ChannelTypePerson
                              )
                            );
                          if (channelInfo) {
                            reply.fromName = channelInfo.title;
                          }
                          reply.content = vm.currentReplyMessage.content;
                          content.reply = reply;
                          vm.currentReplyMessage = undefined;
                        }

                        // ── 附件发送（从编辑器中提取） ──────────────
                        const filesToSend =
                          attachments?.map((a) => a.file) || [];
                        if (filesToSend.length > 0) {
                          for (const file of filesToSend) {
                            try {
                              if (file.type && file.type.startsWith("image/")) {
                                const reader = new FileReader();
                                const previewUrl = await new Promise<string>(
                                  (resolve) => {
                                    reader.onloadend = () =>
                                      resolve(reader.result as string);
                                    reader.onerror = () => resolve(""); // 文件损坏时不阻塞后续附件
                                    reader.readAsDataURL(file);
                                  }
                                );
                                if (!previewUrl) {
                                  Toast.error(`图片「${file.name}」读取失败`);
                                  continue;
                                }
                                // 读取真实宽高，供渲染层正确计算尺寸
                                const { width, height } = await new Promise<{
                                  width: number;
                                  height: number;
                                }>((resolve) => {
                                  const img = new Image();
                                  img.onload = () =>
                                    resolve({
                                      width: img.naturalWidth,
                                      height: img.naturalHeight,
                                    });
                                  img.onerror = () =>
                                    resolve({ width: 0, height: 0 });
                                  img.src = previewUrl;
                                });
                                await this.sendMediaAndWait(
                                  new ImageContent(
                                    file,
                                    previewUrl,
                                    width,
                                    height
                                  )
                                );
                              } else {
                                const name = file.name || "unknown";
                                const dotIndex = name.lastIndexOf(".");
                                const ext =
                                  dotIndex > 0
                                    ? name.substring(dotIndex + 1)
                                    : "";
                                await this.sendMediaAndWait(
                                  new FileContent(file, name, ext, file.size)
                                );
                              }
                            } catch (err) {
                              Toast.error(`文件「${file.name}」发送失败`);
                            }
                          }
                        }

                        // 文字（有内容才发，await 保证在附件全部发完后才发）
                        if (text && text.trim() !== "") {
                          await this.sendMessage(content);
                        }
                      }}
                    ></MessageInput>
                  </div>
                </div>
              </div>
              <ContextMenus
                onContext={(ctx) => {
                  this.contextMenusContext = ctx;
                }}
                menus={
                  vm.selectMessage
                    ? WKApp.endpoints
                        .messageContextMenus(vm.selectMessage, this)
                        .map((menus) => {
                          return {
                            title: menus.title,
                            onClick: () => {
                              if (menus.onClick) {
                                menus.onClick();
                              }
                            },
                          };
                        })
                    : []
                }
              ></ContextMenus>
              <ContextMenus
                onContext={(ctx) => {
                  this.avatarMenusContext = ctx;
                }}
                menus={[
                  {
                    title: "@TA",
                    onClick: () => {
                      if (!this.vm.selectUID) {
                        return;
                      }
                      const channel = new Channel(
                        this.vm.selectUID,
                        ChannelTypePerson
                      );
                      const channelInfo =
                        WKSDK.shared().channelManager.getChannelInfo(channel);

                      this.messageInputContext()?.addMention(
                        this.vm.selectUID,
                        channelInfo?.title || ""
                      );
                    },
                  },
                  {
                    title: "查看用户信息",
                    onClick: () => {
                      if (!this.vm.selectUID) {
                        return;
                      }
                      let fromChannel: Channel | undefined;
                      let vercode: string | undefined;
                      if (this.vm.channel.channelType === ChannelTypeGroup) {
                        fromChannel = this.vm.channel;
                        const subscriber = this.vm.subscriberWithUID(
                          this.vm.selectUID
                        );
                        if (subscriber?.orgData?.vercode) {
                          vercode = subscriber?.orgData?.vercode;
                        }
                      }
                      WKApp.shared.baseContext.showUserInfo(
                        this.vm.selectUID,
                        fromChannel,
                        vercode
                      );
                    },
                  },
                ]}
              />
            </>
          );
        }}
      ></Provider>
    );
  }
}

interface ConversationPositionViewProps extends HTMLProps<any> {
  showScrollToBottom: boolean; // 是否显示滚动到底部
  reminders: Reminder[] | undefined; //  提醒项
  unreadCount: number; // 未读数量
  onScrollToBottom: () => Promise<void>; // 滚动到底部
  onReminder: (reminder: Reminder) => Promise<void>;
}

interface ConversationPositionViewState {
  loading: Map<number, boolean>;
}

class ConversationPositionView extends Component<
  ConversationPositionViewProps,
  ConversationPositionViewState
> {
  constructor(props: ConversationPositionViewProps) {
    super(props);
    this.state = {
      loading: new Map(),
    };
  }
  getReminderIcon(reminderType: ReminderType) {
    switch (reminderType) {
      case ReminderType.ReminderTypeMentionMe:
        return new URL("./assets/reminder_mention.png", import.meta.url).href;
      case ReminderType.ReminderTypeApplyJoinGroup:
        return new URL("./assets/reminder_member_invite.png", import.meta.url)
          .href;
    }
  }

  getReminderTypes(reminders: Reminder[] | undefined) {
    if (!reminders || reminders.length === 0) {
      return [];
    }
    const types = new Set<number>();
    if (reminders && reminders.length > 0) {
      for (const reminder of reminders) {
        types.add(reminder.reminderType);
      }
    }
    return Array.from(types);
  }

  getRemindersWithType(type: ReminderType) {
    const { reminders } = this.props;
    const newReminders = new Array<Reminder>();
    if (reminders && reminders.length > 0) {
      for (const reminder of reminders) {
        if (reminder.reminderType === type) {
          newReminders.push(reminder);
        }
      }
    }
    return newReminders;
  }

  render(): React.ReactNode {
    const { loading } = this.state;
    const {
      showScrollToBottom,
      unreadCount,
      onScrollToBottom,
      reminders,
      onReminder,
    } = this.props;
    const types = this.getReminderTypes(reminders);
    return (
      <div className="wk-conversationpositionview">
        <ul>
          {types &&
            types.map((type) => {
              const typeReminders = this.getRemindersWithType(type);
              return (
                <li key={type}>
                  <div
                    className={classNames(
                      "wk-conversationpositionview-item",
                      "wk-reveale"
                    )}
                    onClick={async () => {
                      if (onReminder) {
                        if (typeReminders && typeReminders.length > 0) {
                          loading.set(type, true);
                          this.setState({
                            loading: loading,
                          });
                          await onReminder(typeReminders[0]);
                          loading.set(type, false);
                          this.setState({
                            loading: loading,
                          });
                        }
                      }
                    }}
                  >
                    {this.getReminderIcon(type) ? (
                      loading.get(type) ? (
                        <Spin spinning={true}></Spin>
                      ) : (
                        <img src={this.getReminderIcon(type)}></img>
                      )
                    ) : undefined}

                    {typeReminders.length > 0 ? (
                      <div className="wk-conversation-unread-count">
                        {typeReminders.length}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}

          <li>
            <div
              className={classNames(
                "wk-conversationpositionview-item",
                showScrollToBottom ? "wk-reveale" : undefined
              )}
              onClick={async () => {
                if (onScrollToBottom) {
                  loading.set(-1, true);
                  this.setState({
                    loading: loading,
                  });
                  await onScrollToBottom();
                  loading.set(-1, false);
                  this.setState({
                    loading: loading,
                  });
                }
              }}
            >
              {loading.get(-1) ? (
                <Spin spinning={true}></Spin>
              ) : (
                <img src={require("./assets/message_down.png")}></img>
              )}
              {unreadCount > 0 ? (
                <div className="wk-conversation-unread-count">
                  {unreadCount}
                </div>
              ) : null}
            </div>
          </li>
        </ul>
      </div>
    );
  }
}

interface ReplyViewProps {
  message: Message;
  vm: ConversationVM;
  onClose?: () => void;
}
class ReplyView extends Component<ReplyViewProps> {
  render(): React.ReactNode {
    const { message, onClose, vm } = this.props;
    const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(message.fromUID, ChannelTypePerson)
    );
    const isEdit = vm.currentHandlerType === 2;
    const label = isEdit ? "编辑" : "回复";
    const userName = fromChannelInfo?.title || "";
    const messageText = message.remoteExtra?.isEdit
      ? message.remoteExtra?.contentEdit?.conversationDigest
      : message.content.conversationDigest;

    return (
      <div className="wk-replyview-new">
        <button
          className="wk-replyview-new-close"
          onClick={() => {
            if (onClose) {
              onClose();
            }
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div className="wk-replyview-new-divider"></div>
        <div className="wk-replyview-new-content">
          <span className="wk-replyview-new-label">{label}</span>
          <span className="wk-replyview-new-name">{userName}：</span>
          <span className="wk-replyview-new-text">{messageText}</span>
        </div>
      </div>
    );
  }
}

interface MultiplePanelProps {
  onClose?: () => void;
  onForward?: () => void; // 逐条转发
  onMergeForward?: () => void; // 合并转发
  onDelete?: () => void; // 删除
}
class MultiplePanel extends Component<MultiplePanelProps> {
  render(): React.ReactNode {
    const { onClose, onForward, onMergeForward, onDelete } = this.props;
    return (
      <div className="wk-multiplepanel">
        <div
          className="wk-multiplepanel-close"
          onClick={() => {
            if (onClose) {
              onClose();
            }
          }}
        >
          <IconClose size="large" />
        </div>
        <div className="wk-multiplepanel-content">
          <div
            className="wk-multiplepanel-content-item"
            onClick={() => {
              if (onForward) {
                onForward();
              }
            }}
          >
            <div className="wk-multiplepanel-content-item-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 14 4 9 9 4"></polyline>
                <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
              </svg>{" "}
            </div>
            <div className="wk-multiplepanel-content-item-title">逐条转发</div>
          </div>
          <div
            className="wk-multiplepanel-content-item"
            onClick={() => {
              if (onMergeForward) {
                onMergeForward();
              }
            }}
          >
            <div className="wk-multiplepanel-content-item-icon">
              <svg
                className="wk-multiplepanel-content-item-icon-svg"
                aria-hidden="true"
                viewBox="0 0 1024 1024"
              >
                <path d="M362.666667 704h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H362.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333zM106.666667 874.666667h810.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v42.666667a21.333333 21.333333 0 0 1-21.333334 21.333333H106.666667a21.333333 21.333333 0 0 1-21.333334-21.333333v-42.666667a21.333333 21.333333 0 0 1 21.333334-21.333333z m427.093333-661.034667V57.152c0-3.84 1.6-7.530667 4.416-10.24a15.36 15.36 0 0 1 21.184 0L846.72 326.122667a21.205333 21.205333 0 0 1 0 30.698666L559.36 635.754667a15.253333 15.253333 0 0 1-10.602667 4.245333 14.72 14.72 0 0 1-14.976-14.485333v-155.733334H503.893333c-116.053333 0-203.946667 22.762667-257.301333 89.792-4.416 5.546667-9.216 11.264-16.256 20.096a8.106667 8.106667 0 0 1-5.248 3.264c-3.989333 0.512-7.125333-1.536-8.128-6.144-2.730667-14.421333-3.626667-29.866667-3.626667-40.746666 0-175.210667 143.466667-322.410667 320.426667-322.410667z m85.333333 85.333333h-85.333333c-80.277333 0-151.914667 41.984-194.453333 104.981334 47.722667-13.44 102.421333-19.52 164.586666-19.52h115.2v74.410666l120.96-117.397333-120.96-117.504v75.029333z"></path>
              </svg>
            </div>
            <div className="wk-multiplepanel-content-item-title">合并转发</div>
          </div>
          <div
            className="wk-multiplepanel-content-item"
            onClick={() => {
              if (onDelete) {
                onDelete();
              }
            }}
          >
            <div className="wk-multiplepanel-content-item-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>{" "}
            </div>
            <div className="wk-multiplepanel-content-item-title">删除</div>
          </div>
        </div>
      </div>
    );
  }
}
