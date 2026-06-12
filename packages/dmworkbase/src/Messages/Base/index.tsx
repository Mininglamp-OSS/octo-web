import WKSDK from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import {
  Channel,
  ChannelInfo,
  ChannelTypePerson,
  ChannelTypeGroup,
  MessageStatus,
} from "wukongimjssdk";
import { Component, CSSProperties, HTMLProps } from "react";
import "./index.css";
import { BubblePosition, MessageWrap } from "../../Service/Model";
import ConversationContext from "../../Components/Conversation/context";
import React from "react";
import {
  MessageContentTypeConst,
  MessageReasonCode,
} from "../../Service/Const";
import { IConversationProvider } from "../../Service/DataSource/DataProvider";
import WKApp from "../../App";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import {
  personalRemarkDisplayName,
  subscriberDisplayName,
} from "../../Utils/displayName";
import { shouldShowRealnameBadge } from "../../Utils/realnameBadge";
import {
  resolveWebhookRowDisplay,
  webhookFromOfMessage,
} from "../../Service/IncomingWebhook";
import { css } from "@emotion/react";
// import ClockLoader from "react-spinners/ClockLoader";
import Checkbox from "../../Components/Checkbox";
import classNames from "classnames";
import { Popconfirm } from "@douyinfe/semi-ui";
import WKAvatar from "../../Components/WKAvatar";
import AiBadge from "../../Components/AiBadge";
import WebhookBadge from "../../Components/WebhookBadge";
import RealnameVerifiedBadge from "../../Components/RealnameVerifiedBadge";
import { getTitleColor } from "./head";
import ThreadIndicator, {
  ThreadIndicatorData,
} from "../../Components/ThreadIndicator";
import { isMessageContinuation } from "../../Service/messageContinuity";
import { isMessageSelectable } from "../../Service/messageSelection";
import { I18nContext } from "../../i18n";
import { formatMessageTimestamp } from "../../Utils/time";

interface MessageBaseProps extends HTMLProps<any> {
  message: MessageWrap;
  context: ConversationContext;
  hiddenStatus?: boolean;
  threadInfo?: ThreadIndicatorData;
  onThreadClick?: () => void;
  bubbleStyle?: CSSProperties;
  hiddeBubble?: boolean;
  onBubble?: () => void;
}

export default class MessageBase extends Component<MessageBaseProps, any> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  channelInfoListener!: ChannelInfoListener;
  subscriberChangeListener!: (channel: Channel) => void;
  conversationProvider: IConversationProvider;

  constructor(props: any) {
    super(props);
    this.conversationProvider = WKApp.conversationProvider;
  }
  componentDidMount() {
    const self = this;

    // 收窄 conversation channelInfo fetch/listen
    // 到仅 Person 1v1。timing race 只发生在 self-sent Person 1v1 + 首帧缓存未到的
    // bot DM 场景，群消息不需要拉 group channelInfo 来判 self fallback。
    // 在 1v1 场景中 message.channel 和
    // sender Person Channel 是同一个（fromUID 即对端）。render 路径另有一处
    // 会 fetch sender channelInfo（本文件 line ~341），不 dedupe 的话 legacy 媒体/
    // 文件消息历史首屏会双倍 fetch。这里用 fromUID 做 dedupe：
    // 对方发来的 1v1 消息，msgChannel.channelID === fromUID → 不重复 fetch。
    const msgChannel = this.props.message.channel;
    const msgFromUID = this.props.message.fromUID;
    if (
      msgChannel &&
      msgChannel.channelType === ChannelTypePerson &&
      !(msgFromUID && msgChannel.channelID === msgFromUID)
    ) {
      const convCached = WKSDK.shared().channelManager.getChannelInfo(
        msgChannel
      );
      if (!convCached) {
        WKSDK.shared().channelManager.fetchChannelInfo(msgChannel);
      }
    }

    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      if (!channelInfo) {
        return;
      }
      const { message } = self.props;
      // 发送者 channelInfo（Person）到达 → rerender（姓名 / 徽章 / is-bot 判定）
      if (message.fromUID === channelInfo.channel.channelID) {
        self.setState({});
        return;
      }
      // 会话对端 channelInfo 到达 → rerender，让徽章走真实
      // isBotConversation 判定（替换首帧保守兜底）。
      const convChannel = message.channel;
      if (
        convChannel &&
        channelInfo.channel.channelID === convChannel.channelID &&
        channelInfo.channel.channelType === convChannel.channelType
      ) {
        self.setState({});
      }
    };
    WKSDK.shared().channelManager.addListener(this.channelInfoListener);

    // 群成员到达 / 更新时触发重渲染：群消息发送者名字优先从群成员列表取，
    // 成员列表是异步同步的，消息可能先于成员列表到达，需要通知一次。
    this.subscriberChangeListener = (channel: Channel) => {
      const { message } = self.props;
      if (message.channel.isEqual(channel)) {
        self.setState({});
      }
    };
    WKSDK.shared().channelManager.addSubscriberChangeListener(
      this.subscriberChangeListener
    );
  }

  componentWillUnmount() {
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
    WKSDK.shared().channelManager.removeSubscriberChangeListener(
      this.subscriberChangeListener
    );
  }

  forceStandalone() {
    const { context, message } = this.props;
    return context.forceStandaloneMessage?.(message.message) || false;
  }

  getDisplayBubblePosition(): BubblePosition {
    if (this.forceStandalone()) {
      return BubblePosition.single;
    }
    return this.props.message.bubblePosition;
  }

  // 消息是否连续的
  isContinue(): boolean {
    if (this.forceStandalone()) {
      return false;
    }
    const { message } = this.props;
    return isMessageContinuation(message.preMessage, message);
  }

  getMessageStyle(hasContinue: boolean, message: MessageWrap) {
    const messageStyle: any = {};
    messageStyle.marginBottom = "15px";
    if (this.forceStandalone()) {
      return messageStyle;
    }
    if (hasContinue && message.send) {
      messageStyle.marginTop = "4px";
      messageStyle.marginBottom = "0px";
      messageStyle.marginLeft = "0px";
      messageStyle.marginRight = "5px";
    }
    if (hasContinue && !message.send) {
      messageStyle.marginTop = "4px";
      messageStyle.marginBottom = "0px";
      messageStyle.marginRight = "0px";
    }
    if (!hasContinue) {
      if (isMessageContinuation(message, message.nextMessage)) {
        messageStyle.marginBottom = "0px";
      }
    }
    if (!isMessageContinuation(message, message.nextMessage)) {
      messageStyle.marginBottom = "15px";
    }
    return messageStyle;
  }

  getBubbleRadius(hasContinue: boolean, message: MessageWrap): string {
    if (message.send) {
      return "20px 4px 8px 20px";
    }
    if (
      hasContinue &&
      isMessageContinuation(message, message.nextMessage)
    ) {
      return "8px 20px 20px 8px";
    }
    if (
      hasContinue &&
      !isMessageContinuation(message, message.nextMessage)
    ) {
      return "8px 20px 20px 8px";
    }
    return "8px 20px 20px";
  }

  getBubbleStyle() {
    const { bubbleStyle, message } = this.props;
    let newBubbleStyle = bubbleStyle;
    const hasContinue = this.isContinue();
    if (!newBubbleStyle) {
      newBubbleStyle = {};
    }
    newBubbleStyle.borderRadius = this.getBubbleRadius(hasContinue, message);
    return newBubbleStyle;
  }

  onMessageRevoke() {
    const { message } = this.props;
    this.conversationProvider.revokeMessage(message.message);
  }
  onMultiple() {
    const { context } = this.props;
    context.setEditOn(true);
  }

  onMessageDelete() {
    const { context, message } = this.props;
    context.deleteMessages([message.message]);
  }

  getBubbleBoxClassName() {
    const { message, hiddeBubble } = this.props;
    const bubblePosition = this.getDisplayBubblePosition();
    let messageBubble = "wk-message-base-bubble-box";

    if (hiddeBubble) {
      messageBubble += " hide";
    }
    if (message.contentType === MessageContentTypeConst.file) {
      messageBubble += " fileBox";
    }
    if (message.send) {
      messageBubble += " send";
    } else {
      messageBubble += " recv";
      if (this.isAiMessage()) {
        messageBubble += " ai-panel";
      }
    }
    if (bubblePosition === BubblePosition.first) {
      messageBubble += " first";
    } else if (bubblePosition === BubblePosition.middle) {
      messageBubble += " middle";
    } else if (bubblePosition === BubblePosition.last) {
      messageBubble += " last";
    } else if (bubblePosition === BubblePosition.single) {
      messageBubble += " single";
    }
    return messageBubble;
  }

  isAiMessage() {
    const { message } = this.props;
    if (message.send) return false;
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(message.fromUID, ChannelTypePerson)
    );
    return channelInfo?.orgData?.robot === 1;
  }

  needAvatar() {
    const { message } = this.props;
    const bubblePosition = this.getDisplayBubblePosition();
    return (
      (bubblePosition === BubblePosition.first ||
        bubblePosition === BubblePosition.single) &&
      !!message.fromUID
    );
  }

  needHead() {
    const bubblePosition = this.getDisplayBubblePosition();
    return (
      bubblePosition === BubblePosition.first ||
      bubblePosition === BubblePosition.single
    );
  }

  getMessageErrorReason() {
    const { message } = this.props;
    switch (message.reasonCode) {
      case MessageReasonCode.reasonSubscriberNotExist:
        return this.context.t("base.messageBase.error.removedFromGroup");
      case MessageReasonCode.reasonNotAllowSend:
      case MessageReasonCode.reasonNotInWhitelist:
      case MessageReasonCode.reasonInBlacklist: {
        const { context } = this.props;
        if (context) {
          const ch = context.channel();
          if (ch && ch.channelType === ChannelTypePerson) {
            const chInfo = WKSDK.shared().channelManager.getChannelInfo(ch);
            if (chInfo?.orgData?.robot === 1) {
              return this.context.t("base.messageBase.error.addBotFriendFirst");
            }
          }
        }
        return this.context.t("base.messageBase.error.muted");
      }
      case MessageReasonCode.reasonSystemError:
        return this.context.t("base.messageBase.error.system");
    }
  }

  render() {
    const { message, context, hiddeBubble, bubbleStyle } = this.props;
    const hasContinue = this.isContinue();
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(message.fromUID, ChannelTypePerson)
    );
    const avatarChannel =
      channelInfo?.channel || new Channel(message.fromUID, ChannelTypePerson);
    // 群消息的发送者名字优先从群成员列表取（群内昵称 remark > 全局 name），
    // 群成员列表进群时就批量加载好了，命中率远高于单查 Person ChannelInfo。
    // 对成员列表未命中的场景（超级群分页外、时序窗口内、私聊）再降级到
    // Person ChannelInfo；都拿不到则留空，避免把 32 位 UID 暴露到 UI。
    let groupMemberName = "";
    // Epic #1169: 实名徽章的判断也优先读群成员 orgData，回退
    // Person ChannelInfo.orgData（私聊或群成员列表未命中场景）。
    let groupMember: any = undefined;
    if (message.channel.channelType === ChannelTypeGroup && message.fromUID) {
      try {
        const subs = WKSDK.shared().channelManager.getSubscribes(
          message.channel
        ) as any[] | null | undefined;
        const member = subs?.find((s) => s && s.uid === message.fromUID);
        groupMemberName = subscriberDisplayName(member);
        groupMember = member;
      } catch {
        // channelManager 未初始化 / 缓存未加载：静默降级
      }
    }
    // channelInfo 未命中时不要把 fromUID（32 位 hex）当兜底名字显示给用户，
    // 留空等待 fetchChannelInfo 回包后由 channelInfoListener 触发重渲染。
    //
    // 本文件仍在生产渲染 Voice / Gif / Location / File / Video 等类型的气泡，
    // 需要和 bridge 路径保持同一视觉规则：
    //   自己发送的消息，groupMember 通常不含 self、channelInfo.orgData 也
    //   不带 real_name（self Person channelInfo 不下发这个字段），导致 self
    //   气泡永远显示 username 而非 "余嘉伟"。接入登录 payload 后，
    //   权威 real_name 在 `WKApp.loginInfo` 上，self 分支走 selfDisplayName()
    //   即可拿到。规则改动请同步 bridge/message/useMessageRow.ts。
    const isOwnMessageName =
      message.fromUID && message.fromUID === WKApp.loginInfo.uid;
    // 个人备注来自 sender 的 Person channelInfo。群消息虽然主路径读 subscriber，
    // 但个人备注必须优先于群成员名，才能在 friend/remark 保存并刷新
    // Person channelInfo 后立即反映到聊天框。
    const personalRemarkName = personalRemarkDisplayName(channelInfo);
    // 群入站 Webhook 消息（FromUID = iwh_*，永远不是群成员）：
    // 名字/头像读 payload from 元信息，不查 ChannelInfo、不发 fetchChannelInfo
    const webhookFrom = webhookFromOfMessage(message);
    const webhookDisplay = webhookFrom
      ? resolveWebhookRowDisplay(webhookFrom)
      : undefined;
    const displayName = webhookDisplay
      ? webhookDisplay.senderName
      : isOwnMessageName
      ? WKApp.loginInfo.selfDisplayName() ||
        personalRemarkName ||
        groupMemberName ||
        channelInfo?.orgData?.displayName ||
        channelInfo?.title ||
        ""
      : personalRemarkName ||
        groupMemberName ||
        channelInfo?.orgData?.displayName ||
        channelInfo?.title ||
        "";
    if (!channelInfo && !webhookFrom && message.fromUID && message.fromUID !== "") {
      WKSDK.shared().channelManager.fetchChannelInfo(
        new Channel(message.fromUID, ChannelTypePerson)
      );
    }
    const messageStyle = this.getMessageStyle(hasContinue, message);
    const isAi = this.isAiMessage();
    const showHead = this.needHead();
    const showAvatar = this.needAvatar();
    const timeStr = formatMessageTimestamp(message.timestamp);
    const selectionMode = context.editOn();
    const selectable = isMessageSelectable(message);

    // 外部群成员来源标记：按当前查看 Space 相对渲染。
    // 优先读 msg-level 新字段 from_home_space_id / from_home_space_name；
    // 缺失时回落到旧 msg-level (from_is_external/from_source_space_name)，
    // 再回落到 channelInfo.orgData。系统消息 / 机器人 / AI 不展示。
    const isGroupMsg = message.channel.channelType === ChannelTypeGroup;
    const viewerSpaceId = WKApp.shared.currentSpaceId;
    const msgRes = resolveExternalForViewer({
      homeSpaceId: message.fromHomeSpaceId,
      homeSpaceName: message.fromHomeSpaceName,
      isExternalLegacy: message.fromIsExternal ? 1 : 0,
      sourceSpaceNameLegacy: message.fromSourceSpaceName,
      viewerSpaceId,
    });
    const hasMsgLevelExt =
      !!message.fromHomeSpaceId ||
      (message.fromIsExternal && !!message.fromSourceSpaceName);
    const orgRes = isGroupMsg
      ? resolveExternalForViewer({
          homeSpaceId: channelInfo?.orgData?.home_space_id as
            | string
            | undefined,
          homeSpaceName: channelInfo?.orgData?.home_space_name as
            | string
            | undefined,
          isExternalLegacy: channelInfo?.orgData?.is_external,
          sourceSpaceNameLegacy: channelInfo?.orgData?.source_space_name as
            | string
            | undefined,
          viewerSpaceId,
        })
      : { isExternal: false, sourceSpaceName: "" };
    const extResolved = hasMsgLevelExt ? msgRes : orgRes;
    const showExtOrigin = !isAi && extResolved.isExternal;
    const extSourceSpaceName = extResolved.sourceSpaceName;

    // Epic dmwork-web#1169: 聊天气泡作者名旁的实名徽章。
    //
    // 本目录 Messages/ 中的某些消息类型（Voice / Gif / Location / File / Video）
    // 仍走 MessageBase 而未迁到新 MessageRow。产品需求要求所有消息类型气泡都显示
    // 徽章，因此这里必须和 bridge 路径走 **同一套** 判定规则。
    //
    // 共享 helper `shouldShowRealnameBadge` 的优先级：isAi → isBotConversation →
    // isBotSender → groupMember orgData → channelInfo orgData → self-fallback。
    // 判定维度对齐 `src/bridge/message/useMessageRow.ts`，任何规则改动请同步两处。
    const conversationChannelInfo = message.channel
      ? WKSDK.shared().channelManager.getChannelInfo(message.channel)
      : undefined;
    const isOwnMessage = message.fromUID === WKApp.loginInfo.uid;
    // Legacy dir 例外：和 bridge 路径 useMessageRow.ts 对齐。
    // Person 1v1 + self-sent + 对端 channelInfo 首帧未缓存时采取保守策略：
    // 把 isBotConversation 先当 true 压制 self-fallback，防止 self-sent bot
    // DM 首帧误显 ✓。listener 会在 channelInfo 到达后 rerender 切回真实判定。
    const isPersonConversation =
      message.channel?.channelType === ChannelTypePerson;
    const conversationChannelInfoMissing =
      isPersonConversation && !conversationChannelInfo;
    const isBotConversation =
      conversationChannelInfo?.orgData?.robot === 1 ||
      (conversationChannelInfoMissing && isOwnMessage);
    const isBotSender = channelInfo?.orgData?.robot === 1;
    const showRealnameBadge = shouldShowRealnameBadge({
      isAi,
      isBotConversation,
      isBotSender,
      isOwnMessage,
      groupMemberOrgData: groupMember?.orgData,
      channelInfoOrgData: channelInfo?.orgData,
      loginRealnameVerified: WKApp.loginInfo.realnameVerified,
    });

    return (
      <div
        className={classNames(
          "wk-message-base",
          selectionMode && selectable ? "wk-message-base-check-open" : undefined
        )}
        onClick={
          selectionMode
            ? () => {
                if (selectable) {
                  context.checkeMessage(message.message, !message.checked);
                }
              }
            : undefined
        }
      >
        {selectionMode && selectable ? (
          <div
            className="wk-message-base-checkBox"
            style={{ marginBottom: messageStyle.marginBottom }}
          >
            <Checkbox checked={selectable && message.checked} />
          </div>
        ) : null}
        <div
          className={
            message.send ? "wk-message-base-send" : "wk-message-base-recv"
          }
          style={messageStyle}
        >
          <div
            className={"wk-message-base-box"}
            style={{ pointerEvents: selectionMode ? "none" : undefined }}
          >
            {message.send && message.status === MessageStatus.Fail ? (
              <Popconfirm
                title={this.context.t("base.messageBase.resendConfirm.title")}
                okText={this.context.t("base.messageBase.resendConfirm.ok")}
                cancelText={this.context.t("base.messageBase.resendConfirm.cancel")}
                onConfirm={() => {
                  context.resendMessage(message.message);
                }}
              >
                <div className="messageFail">
                  <img src={require("./msg_status_fail.png")} alt=""></img>
                </div>
              </Popconfirm>
            ) : undefined}

            {/* 头像：flex item，仅 first/single 显示，否则占位 */}
            <div
              className={classNames(
                "senderAvatar",
                showAvatar ? undefined : "senderAvatar-placeholder"
              )}
              onClick={
                // webhook 发送者没有个人资料页，点击不响应
                showAvatar && !(webhookDisplay && !webhookDisplay.avatarClickable)
                  ? (el) => {
                      context.onTapAvatar(message.fromUID, el);
                    }
                  : undefined
              }
            >
              {showAvatar &&
                (webhookDisplay && webhookDisplay.avatarUrl ? (
                  // webhook 管理员自定义头像
                  <WKAvatar
                    src={webhookDisplay.avatarUrl}
                    style={{ width: "32px", height: "32px" }}
                  />
                ) : (
                  // 普通消息，以及无自定义头像的 webhook：都走用户头像链路
                  <WKAvatar
                    channel={avatarChannel}
                    style={{ width: "32px", height: "32px" }}
                  />
                ))}
            </div>

            {/* 消息体列 */}
            <div className="wk-msg-body">
              {/* Head 行：name + time (发送和接收都显示,布局一致) */}
              {showHead && !isAi && (
                <div className="wk-msg-head">
                  <span
                    className="wk-msg-head-name"
                    style={{ color: getTitleColor(displayName) }}
                  >
                    {displayName}
                  </span>
                  {/* Epic dmwork-web#1169: 实名徽章紧贴作者名右侧，
                      只 variant="icon" 迷你形态，已实名用户才渲染，未实名
                      一律不加任何负担标识。Phase A。*/}
                  {showRealnameBadge && (
                    <RealnameVerifiedBadge variant="icon" />
                  )}
                  {/* 外部群成员「@SpaceName」后缀（企微风格）。
                      按当前查看 Space 相对渲染，观察者 home_space 与成员
                      home_space 不同时显示；优先 msg-level，回落 orgData。*/}
                  {showExtOrigin && extSourceSpaceName && (
                    <span
                      className="wk-msg-head-space"
                      title={`@${extSourceSpaceName}`}
                    >
                      @{extSourceSpaceName}
                    </span>
                  )}
                  {channelInfo?.orgData?.robot === 1 && (
                    <AiBadge size="small" />
                  )}
                  {webhookDisplay?.showBadge && <WebhookBadge />}
                  <span className="wk-msg-head-time">{timeStr}</span>
                </div>
              )}

              <div className={this.getBubbleBoxClassName()}>
                <div
                  className="wk-message-base-bubble"
                  style={bubbleStyle}
                  onContextMenu={(event) => {
                    context.showContextMenus(message.message, event);
                  }}
                  data-message-seq={message.messageSeq}
                >
                  {/* AI 面板头部 */}
                  {isAi && showHead && (
                    <div className="wk-ai-panel-head">
                      <span className="wk-ai-panel-agent-name">
                        {displayName}
                      </span>
                      <AiBadge size="small" />
                    </div>
                  )}
                  <div className="wk-message-base-content">
                    {this.props.children}
                  </div>
                  {/* AI 面板底栏 */}
                  {isAi && (
                    <div className="wk-ai-panel-foot">
                      <span className="messageTime">{timeStr}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Thread 指示条 */}
              {this.props.threadInfo && (
                <ThreadIndicator
                  data={this.props.threadInfo}
                  isSend={message.send}
                  onClick={this.props.onThreadClick}
                />
              )}
            </div>
          </div>

          {message.status === MessageStatus.Fail ? (
            <div className="wk-message-error-reason">
              {this.getMessageErrorReason()}
            </div>
          ) : undefined}
        </div>
      </div>
    );
  }
}
