import React from "react";
import MessageBase from "../Base";
import MessageTrail from "../Base/tail";
import { MessageBaseCellProps, MessageCell } from "../MessageCell";
import { SummaryCardContent } from "./SummaryCardContent";
import SummaryCardView from "./SummaryCardView";
import WKApp from "../../App";
import { I18nContext } from "../../i18n";

function formatShortDate(dateStr: string, locale: string): string {
  if (!dateStr) return "";
  const value = new Date(dateStr);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(value);
}

export class SummaryCardCell extends MessageCell<MessageBaseCellProps> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  render() {
    const { message, context } = this.props;
    const content = message.content as SummaryCardContent;
    const { locale, t } = this.context;
    const start = formatShortDate(content.timeRangeStart, locale);
    const end = formatShortDate(content.timeRangeEnd, locale);
    const sourceName = content.sourceName || (content.sourceCount > 0
      ? content.summaryMode === 2
        ? t("base.summaryCard.memberCount", { values: { count: content.sourceCount } })
        : t("base.summaryCard.groupCount", { values: { count: content.sourceCount } })
      : "");
    const timeRange = start && end
      ? start === end ? start : t("base.summaryCard.coverage", { values: { start, end } })
      : "";

    const openLegacy = () => WKApp.openSummaryDetail?.(content.taskNo || content.taskId, content.spaceId);
    const conversationChannel = context.channel?.() || message.channel;
    const originChannel = conversationChannel
      ? { channelId: conversationChannel.channelID, channelType: conversationChannel.channelType }
      : undefined;
    const openPreview = () => content.shareId
      ? WKApp.openSummarySharePreview?.(content.shareId, content.spaceId, originChannel)
      : openLegacy();
    const openDetail = () => content.shareId
      ? WKApp.openSummaryShareDetail?.(content.shareId, content.spaceId, originChannel)
      : openLegacy();

    return (
      <MessageBase hiddeBubble message={message} context={context}>
        <SummaryCardView
          title={content.title || t("base.summaryCard.title")}
          preview={content.preview}
          meta={{
            sourceName,
            timeRange,
            participantText: content.participantCount > 0
              ? t("base.summaryCard.participantCount", { values: { count: content.participantCount } })
              : "",
            messageText: content.totalMsgCount > 0
              ? t("base.summaryCard.messageCount", { values: { count: content.totalMsgCount } })
              : "",
          }}
          labels={{
            generated: t("base.summaryCard.generated"),
            ai: t("base.summaryCard.aiLabel"),
            sourcePrefix: t("base.summaryCard.sourcePrefix"),
            sourceSuffix: t("base.summaryCard.sourceSuffix"),
            viewAll: t("base.summaryCard.viewAll"),
            viewDetail: content.shareId ? t("base.summaryCard.viewDetails") : t("base.summaryCard.viewFull"),
            footer: t("base.summaryCard.title"),
          }}
          trail={<MessageTrail message={message} timeStyle={{ color: "var(--wk-text-tertiary)" }} />}
          onViewAll={openPreview}
          onViewDetail={openDetail}
        />
      </MessageBase>
    );
  }
}

export default SummaryCardCell;
