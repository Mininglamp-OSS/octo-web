import React from "react";
import WKApp from "../../App";
import { getMessageRow } from "../../bridge/message/useMessageRow";
import { isMessageSelectable } from "../../Service/messageSelection";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import MessageRow from "../../ui/message/MessageRow";
import ReplyBlock from "../../ui/message/ReplyBlock";
import { MessageCell } from "../MessageCell";
import { t } from "../../i18n";
import { InteractiveCardContent } from "./InteractiveCardContent";
import { decideCardBody } from "./renderDecision";
import { resolveEffectiveCardContent } from "./resolveContent";
import { classifyCardSender, fetchSenderChannelInfo } from "./senderTrust";
import "./index.css";

export { InteractiveCardContent } from "./InteractiveCardContent";

/**
 * 根据当前查看 Space 解析被引用消息发送者的「外部来源 Space 名」。
 * 与 TextCell / RichTextCell 保持同一套 resolve 规则。
 */
function resolveReplySourceSpaceName(reply: any): string {
  if (!reply) return "";
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: reply.from_home_space_id as string | undefined,
    homeSpaceName: reply.from_home_space_name as string | undefined,
    isExternalLegacy:
      reply.from_is_external === 1 || reply.from_is_external === true ? 1 : 0,
    sourceSpaceNameLegacy: reply.from_source_space_name as string | undefined,
    viewerSpaceId: WKApp.shared.currentSpaceId,
  });
  return isExternal && sourceSpaceName ? sourceSpaceName : "";
}

/**
 * 纯文本渲染（保留换行）。**不走 markdown/HTML** —— 这是 fallback / 不可信发送者
 * 展示面的安全前提，避免 `[x](javascript:)` 之类被解析成活链接。
 */
function renderPlainText(text: string, keyPrefix: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={`${keyPrefix}-line-${i}`}>
      {line}
      {i !== lines.length - 1 ? <br /> : null}
    </span>
  ));
}

/**
 * InteractiveCard(=17) 互动卡片消息 Cell。
 *
 * 波 1（展示型）职责：
 *   - sender trust gate（T2）：仅可信 bot / iwh_ webhook 才渲结构卡，否则 plain。
 *   - profile/version 协商 + 整卡 fallback plain（T3）。
 *   - AC 静态渲染器（T4）。
 *
 * extends MessageCell（非 MessageBaseCell）以复用基类 channelInfo 到达自动重渲，
 * 支撑 trust gate 的 late-arrival 自愈：pending 时先渲 plain，channelInfo 拉到后
 * 基类 listener setState 触发重渲，重新分类为 bot/human。
 */
export class InteractiveCardCell extends MessageCell {
  /** 避免对同一 pending 发送者重复 fetch。 */
  private _fetchedSenderInfo = false;

  componentDidMount() {
    super.componentDidMount?.();
    this.ensureSenderTrustResolvable();
  }

  componentDidUpdate() {
    this.ensureSenderTrustResolvable();
  }

  /**
   * trust 判定为 pending（非 webhook 且发送者 channelInfo 未命中）时主动拉取，
   * 到达后由基类 channelInfo listener 触发重渲，重新分类。fail-closed 期间渲 plain。
   */
  private ensureSenderTrustResolvable() {
    if (this._fetchedSenderInfo) return;
    const fromUID = this.props.message.fromUID;
    if (classifyCardSender(fromUID) === "pending" && fromUID) {
      this._fetchedSenderInfo = true;
      fetchSenderChannelInfo(fromUID);
    }
  }

  render() {
    const { message, context } = this.props;
    const content = message.content as InteractiveCardContent;

    const selectionMode = context.editOn();
    const selectable = isMessageSelectable(message);
    const rowProps = getMessageRow(
      message,
      {
        selectionMode,
        showCheckbox: selectionMode && selectable,
        isSelected: selectable && !!message.checked,
        onSelect: selectable
          ? (selected) => context.checkeMessage(message.message, selected)
          : undefined,
      },
      {
        onAvatarClick: (uid, e) => context.onTapAvatar(uid, e),
        onSenderNameClick: (uid) => context.showUser(uid),
      }
    );

    const reply = (content as any).reply;

    return (
      <MessageRow
        {...rowProps}
        onContextMenu={(event) => context.showContextMenus(message, event)}
        isActive={context.isContextMenuOpen(message.message)}
        onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
        onSenderNameClick={() => context.showUser(message.fromUID)}
      >
        <div className="wk-interactive-card">
          {reply && (
            <ReplyBlock
              fromName={reply.fromName || ""}
              digest={reply.content?.conversationDigest || ""}
              sourceSpaceName={resolveReplySourceSpaceName(reply)}
              onClick={() => context.locateMessage(reply.messageSeq)}
            />
          )}
          {this.renderBody(content)}
        </div>
      </MessageRow>
    );
  }

  /**
   * 卡片主体渲染：策略决策委托给纯函数 decideCardBody（trust → 协商 → 渲染/兜底），
   * 本方法只负责把决策映射成 JSX。集中兜底，对齐服务端「无 per-element fallback」契约。
   *
   * 编辑更新：bot 改卡后新帧存于 remoteExtra.contentEdit（SDK 已按 type=17 解码），
   * 择优渲染编辑帧；CMDSyncMessageExtra → 拉增量 → 回写 remoteExtra → notifyListener
   * 的重渲链路由 ConversationVM 提供，本 Cell 只需读最新帧。
   */
  private renderBody(content: InteractiveCardContent): React.ReactNode {
    const { message } = this.props;
    const effective = resolveEffectiveCardContent(content, message.remoteExtra);
    const plain = effective.plain?.trim()
      ? effective.plain
      : effective.conversationDigest;
    const plainNode = (
      <div className="wk-interactive-card-plain">
        {renderPlainText(plain, message.clientMsgNo)}
      </div>
    );

    const decision = decideCardBody({
      fromUID: message.fromUID,
      profile: effective.profile,
      cardVersion: effective.cardVersion,
      card: effective.card,
    });

    switch (decision.kind) {
      case "card":
        return decision.node;
      case "hint":
        // 协商失败（不支持 profile/version）：plain + 「需更新客户端」提示。
        return (
          <div className="wk-interactive-card-plain">
            {renderPlainText(plain, message.clientMsgNo)}
            <div className="wk-interactive-card-hint">
              {t("base.message.interactiveCard.needUpdate")}
            </div>
          </div>
        );
      case "plain":
      default:
        // 非可信 sender / 渲染器 fallback → 纯文本（绝不走 markdown/HTML）。
        return plainNode;
    }
  }
}

export default InteractiveCardCell;
