import WKModal from "../../Components/WKModal";
import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
  Message,
  MessageContent,
  Mention,
  Reply,
} from "wukongimjssdk";
import { IconArrowLeft, IconClose } from "@douyinfe/semi-icons";
import React from "react";
import MergeforwardMessageList from "../../Components/MergeforwardMessageList";
import { MessageContentTypeConst } from "../../Service/Const";
import { applyMsgLevelExternalFields } from "../../Service/Convert";
import { isMessageSelectable } from "../../Service/messageSelection";
import MessageBase from "../Base";
import MessageTrail from "../Base/tail";
import { MessageCell } from "../MessageCell";
import MessageRow from "../../ui/message/MessageRow";
import MergeforwardCard from "../../ui/message/MergeforwardCard";
import { getMergeforwardMessageUI } from "../../bridge/message/useMergeforwardMessageUI";
import { I18nContext, t } from "../../i18n";
import { fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";

import "./index.css";

// users 新增外部来源字段。后端在合并转发归档时填充，前端透传即可。
export interface MergeforwardUser {
  uid: string;
  name: string;
  /** 1=外部群成员；0/undefined=非外部 */
  is_external?: number;
  /** 外部成员所属 Space 名称，仅在 is_external=1 时有意义 */
  source_space_name?: string;
}

export default class MergeforwardContent extends MessageContent {
  title!: string;
  channelType!: number;
  users!: Array<MergeforwardUser>;
  msgs!: Array<Message>;

  // SAFETY: decodeJSON must remain fully synchronous; the static counter assumes
  // no decode call yields the event loop before its try/finally completes.
  private static decodeDepth = 0;
  // 8 matches the iOS/Android cap and is well above practical use (3–4 levels).
  // Pure recursion at this depth (~36 frames) is far from V8's stack limit; the
  // real overflow risk is payload-size in the SDK's String.fromCharCode.apply,
  // which is fixed by the TextDecoder override in decode() below.
  private static readonly MAX_DECODE_DEPTH = 8;

  constructor(
    channelType?: number,
    users?: Array<MergeforwardUser>,
    msgs?: Array<Message>
  ) {
    super();
    this.channelType = channelType!;
    this.users = users!;
    this.msgs = msgs!;
  }

  decode(raw: Uint8Array) {
    // The SDK's default MessageContent.decode() uses uint8ArrayToString which calls
    // String.fromCharCode.apply(null, data). For large merge-forward payloads this
    // overflows the call stack. Override to use TextDecoder which is safe for any size.
    // All SDK metadata hydration steps are mirrored below to avoid regressions.
    let contentObj: any;
    try {
      contentObj = JSON.parse(new TextDecoder().decode(raw));
    } catch (_e) {
      this.contentObj = {};
      this.channelType = 0;
      this.users = [];
      this.msgs = [];
      return;
    }
    this.contentObj = contentObj;
    const mentionObj = contentObj["mention"];
    if (mentionObj) {
      const mention = new Mention();
      mention.all = mentionObj["all"] === 1;
      if (mentionObj["uids"]) {
        mention.uids = mentionObj["uids"];
      }
      this.mention = mention;
    }
    const replyObj = contentObj["reply"];
    if (replyObj) {
      const reply = new Reply();
      reply.decode(replyObj);
      this.reply = reply;
    }
    // visibles/invisibles are declared private on MessageContent in the SDK type
    // contract; cast to any to mirror the SDK's own runtime assignment.
    ;(this as any).visibles = contentObj["visibles"];
    ;(this as any).invisibles = contentObj["invisibles"];
    this.decodeJSON(contentObj);
  }

  decodeJSON(content: any) {
    this.channelType = content["channel_type"] || 0;
    const rawUsers: Array<MergeforwardUser> = content["users"] || [];
    const seen = new Set<string>();
    this.users = rawUsers
      .filter((u) => {
        if (seen.has(u.uid)) return false;
        seen.add(u.uid);
        return true;
      })
      .map((u) => {
        // 透传外部来源字段；仅保留有效值避免噪音
        const mapped: MergeforwardUser = { uid: u.uid, name: u.name };
        if (u.is_external === 1 || u.is_external === 0) {
          mapped.is_external = u.is_external;
        }
        if (
          typeof u.source_space_name === "string" &&
          u.source_space_name !== ""
        ) {
          mapped.source_space_name = u.source_space_name;
        }
        return mapped;
      });

    if (MergeforwardContent.decodeDepth >= MergeforwardContent.MAX_DECODE_DEPTH) {
      this.msgs = [];
      if (import.meta.env.DEV) {
        console.warn("[MergeforwardContent] decode depth limit reached, inner msgs truncated");
      }
      return;
    }

    MergeforwardContent.decodeDepth++;
    try {
      const msgMaps = content["msgs"];
      const messages: Message[] = [];
      if (msgMaps && msgMaps.length > 0) {
        for (const msgMap of msgMaps) {
          messages.push(this.mapToMessage(msgMap));
        }
      }
      this.msgs = messages;
    } finally {
      MergeforwardContent.decodeDepth--;
    }
  }
  encodeJSON() {
    const messageMaps: any[] = [];
    if (this.msgs && this.msgs.length > 0) {
      for (const msg of this.msgs) {
        messageMaps.push(this.messageToMap(msg));
      }
    }
    // users 原样透传，保留 is_external / source_space_name
    return {
      channel_type: this.channelType || 0,
      users: this.users,
      msgs: messageMaps,
    };
  }
  get contentType() {
    return MessageContentTypeConst.mergeForward;
  }
  get conversationDigest() {
    return t("base.mergeForward.digest");
  }

  mapToMessage(messageMap: any): Message {
    let message = new Message();
    message.messageID = messageMap["message_id"] != null ? `${messageMap["message_id"]}` : "";
    message.timestamp = messageMap["timestamp"];
    message.fromUID = messageMap["from_uid"];

    let payloadObj = messageMap["payload"];
    if (!payloadObj) {
      payloadObj = {};
    }
    let contentType = 0;
    if (payloadObj) {
      contentType = payloadObj.type;
    }
    const messageContent = WKSDK.shared().getMessageContent(contentType);
    // Use decode() to properly set contentObj and call decodeJSON().
    // For type=11 (MergeforwardContent), the overridden decode() uses TextDecoder
    // instead of the SDK's uint8ArrayToString, preventing call-stack overflow on large
    // payloads. For all other types, decode() handles mention/reply/visibles/invisibles.
    const payloadData = new TextEncoder().encode(JSON.stringify(payloadObj));
    messageContent.decode(payloadData);
    message.content = messageContent;

    // dmwork-web#1069：合并转发内嵌消息同样需要透传外部来源字段，
    // 否则转发历史中的外部成员发言会丢失 @SpaceName 头部标记。
    applyMsgLevelExternalFields(message, messageMap);

    return message;
  }

  messageToMap(message: Message): any {
    // Use contentObj if available, otherwise fall back to encodeJSON()
    let payload = message.content.contentObj;
    if (!payload) {
      payload = { ...message.content.encodeJSON(), type: message.content.contentType };
    } else if (payload.type === undefined) {
      // 防护性检查：确保 contentObj 包含 type 字段
      // 正常情况下 contentObj 来自服务器 payload，应包含 type
      // 但某些边缘情况可能导致丢失，这里兼容处理
      payload = { ...payload, type: message.content.contentType };
    }
    return {
      message_id: message.messageID,
      from_uid: message.fromUID ?? "",
      timestamp: message.timestamp,
      payload: payload,
    };
  }
}

interface MergeforwardCellState {
  showList: boolean;
  navTitle: string;
  canGoBack: boolean;
}

export class MergeforwardCell extends MessageCell<any, MergeforwardCellState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private goBackRef: React.MutableRefObject<(() => void) | null> = { current: null };

  constructor(props: any) {
    super(props);
    this.state = {
      showList: false,
      navTitle: "",
      canGoBack: false,
    };
  }

  getTitle(content: MergeforwardContent) {
    const { locale, t } = this.context;
    if (content.channelType === ChannelTypeGroup) {
      return t("base.mergeForward.groupChatHistory");
    }

    const names = content.users
      .map((v) => v.name)
      .filter(Boolean);

    if (names.length === 0) {
      return t("base.mergeForward.chatHistory");
    }

    const formattedNames = locale === "zh-CN"
      ? names.join("、")
      : new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(names);

    return t("base.mergeForward.userChatHistory", {
      values: { names: formattedNames },
    });
  }

  getMsgListUI(msgs: Message[]) {
    if (!msgs || msgs.length === 0) {
      return;
    }
    let newMsgs = new Array();
    if (msgs.length <= 4) {
      newMsgs = msgs;
    } else {
      newMsgs = msgs.slice(0, 4);
    }
    return newMsgs.map((m: Message) => {
      const channel = new Channel(m.fromUID, ChannelTypePerson);
      const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
      let name = "";
      if (channelInfo) {
        name = channelInfo.title;
      } else {
        void fetchImChannelInfo(WKSDK.shared(), channel);
      }
      return (
        <div key={m.messageID} className="wk-mergeforwards-content-item">
          {name}： {m.content.conversationDigest}
        </div>
      );
    });
  }

  componentDidMount() {
    super.componentDidMount();
  }
  componentWillUnmount() {
    super.componentWillUnmount();
  }

  render() {
    const { message, context } = this.props;
    const { showList } = this.state;
    const content = message.content as MergeforwardContent;

    // TODO: 后续改成 feature flag
    const useNewUI = true;

    // 新 UI 实现
    if (useNewUI) {
      const selectionMode = context.editOn();
      const selectable = isMessageSelectable(message);
      const uiProps = getMergeforwardMessageUI(message, {
        selectionMode,
        showCheckbox: selectionMode && selectable,
        isSelected: selectable && !!message.checked,
        onSelect: selectable
          ? (selected) => context.checkeMessage(message.message, selected)
          : undefined,
      });
      return (
        <>
          <MessageRow
            {...uiProps.row}
            onContextMenu={(event) => context.showContextMenus(message, event)}
            isActive={context.isContextMenuOpen(message.message)}
            onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
            onSenderNameClick={() => context.showUser(message.fromUID)}
          >
            <MergeforwardCard
              {...uiProps.card}
              onClick={
                context.editOn()
                  ? undefined
                  : () => this.setState({ showList: true })
              }
            />
          </MessageRow>
          <WKModal
            className="wk-base-modal wk-mergeforward-modal"
            width="var(--mf-modal-width)"
            visible={showList}
            onCancel={() => this.setState({ showList: false, canGoBack: false, navTitle: "" })}
            footer={null}
            options={{ closable: false }}
            bodyStyle={{ padding: 0, maxHeight: 'var(--mf-modal-body-max-height)', overflowY: 'auto' }}
            style={{ maxHeight: 'var(--mf-modal-max-height)', overflow: 'hidden' }}
            header={
              <div className="wk-mergeforward-modal-header">
                <span className="wk-mergeforward-modal-header-title">
                  {this.state.canGoBack ? (
                    <span className="wk-mergeforward-modal-title-with-back">
                      <button
                        className="wk-mergeforward-modal-back-btn"
                        type="button"
                        aria-label={this.context.t("base.mergeForward.back")}
                        onClick={() => this.goBackRef.current?.()}
                      >
                        <IconArrowLeft size="inherit" />
                      </button>
                      <span>{this.state.navTitle}</span>
                    </span>
                  ) : this.getTitle(content)}
                </span>
                <button
                  className="wk-mergeforward-modal-close-btn"
                  type="button"
                  aria-label={this.context.t("base.mergeForward.close")}
                  onClick={() => this.setState({ showList: false, canGoBack: false, navTitle: "" })}
                >
                  <IconClose size="inherit" />
                </button>
              </div>
            }
          >
            <MergeforwardMessageList
              mergeforwardContent={content}
              visible={showList}
              onClose={() => this.setState({ showList: false, canGoBack: false, navTitle: "" })}
              goBackRef={this.goBackRef}
              onNavigateChange={({ title, canGoBack }) =>
                this.setState({ navTitle: title, canGoBack })
              }
            />
          </WKModal>
        </>
      );
    }

    // 旧 UI 实现（保持向后兼容）
    return (
      <MessageBase hiddeBubble={true} message={message} context={context}>
        <div className="wk-mergeforwards">
          <div
            className="wk-mergeforwards-content"
            onClick={() => {
              this.setState({
                showList: true,
              });
            }}
          >
            <div className="wk-mergeforwards-content-title">
              {this.getTitle(content)}
            </div>
            <div className="wk-mergeforwards-content-items">
              {this.getMsgListUI(content.msgs)}
            </div>
            <div className="wk-mergeforwards-content-line"></div>
            <div className="wk-mergeforwards-content-tip">
              <p>{this.context.t("base.mergeForward.chatHistory")}</p>
              <p>
                {" "}
                <MessageTrail message={message} timeStyle={{ color: "#999" }} />
              </p>
            </div>
          </div>
        </div>
        <WKModal
          className="wk-base-modal wk-mergeforward-modal"
          width="var(--mf-modal-width)"
          visible={showList}
          onCancel={() => {
            this.setState({ showList: false, canGoBack: false, navTitle: "" });
          }}
          options={{ closable: false }}
          bodyStyle={{ padding: 0, maxHeight: 'var(--mf-modal-body-max-height)', overflowY: 'auto' }}
          style={{ maxHeight: 'var(--mf-modal-max-height)', overflow: 'hidden' }}
          header={
            <div className="wk-mergeforward-modal-header">
              <span className="wk-mergeforward-modal-header-title">
                {this.state.canGoBack ? (
                  <span className="wk-mergeforward-modal-title-with-back">
                    <button
                      className="wk-mergeforward-modal-back-btn"
                      type="button"
                      aria-label={this.context.t("base.mergeForward.back")}
                      onClick={() => this.goBackRef.current?.()}
                    >
                      <IconArrowLeft size="inherit" />
                    </button>
                    <span>{this.state.navTitle}</span>
                  </span>
                ) : this.getTitle(content)}
              </span>
              <button
                className="wk-mergeforward-modal-close-btn"
                type="button"
                aria-label={this.context.t("base.mergeForward.close")}
                onClick={() => this.setState({ showList: false, canGoBack: false, navTitle: "" })}
              >
                <IconClose size="inherit" />
              </button>
            </div>
          }
        >
          <MergeforwardMessageList
            mergeforwardContent={content}
            visible={showList}
            onClose={() => this.setState({ showList: false, canGoBack: false, navTitle: "" })}
            goBackRef={this.goBackRef}
            onNavigateChange={({ title, canGoBack }) =>
              this.setState({ navTitle: title, canGoBack })
            }
          />
        </WKModal>
      </MessageBase>
    );
  }
}
