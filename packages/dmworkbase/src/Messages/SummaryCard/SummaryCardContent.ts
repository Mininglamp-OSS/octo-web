import { MessageContent } from "wukongimjssdk";
import { t } from "../../i18n";

export class SummaryCardContent extends MessageContent {
  schemaVersion = 1;
  taskId = 0;
  taskNo = "";
  shareId = "";
  title = "";
  sourceName = "";
  sourceCount = 0;
  participantCount = 0;
  totalMsgCount = 0;
  preview = "";
  timeRangeStart = "";
  timeRangeEnd = "";
  summaryMode = 1;
  spaceId = "";

  get contentType() {
    return 15;
  }

  get conversationDigest() {
    return t("base.message.digest.summaryCard");
  }

  encodeJSON(): Record<string, any> {
    return {
      type: this.contentType,
      schema_version: this.schemaVersion,
      task_id: this.taskId,
      task_no: this.taskNo,
      share_id: this.shareId,
      title: this.title,
      source_name: this.sourceName,
      source_count: this.sourceCount,
      participant_count: this.participantCount,
      total_msg_count: this.totalMsgCount,
      preview: this.preview,
      time_range_start: this.timeRangeStart,
      time_range_end: this.timeRangeEnd,
      summary_mode: this.summaryMode,
      space_id: this.spaceId,
    };
  }

  decodeJSON(content: Record<string, any>): void {
    this.schemaVersion = Number(content.schema_version) || 1;
    this.taskId = Number(content.task_id) || 0;
    this.taskNo = typeof content.task_no === "string" ? content.task_no : "";
    this.shareId = typeof content.share_id === "string" ? content.share_id : "";
    this.title = typeof content.title === "string" ? content.title : "";
    this.sourceName = typeof content.source_name === "string" ? content.source_name : "";
    this.sourceCount = Number(content.source_count) || 0;
    this.participantCount = Number(content.participant_count) || 0;
    this.totalMsgCount = Number(content.total_msg_count) || 0;
    this.preview = typeof content.preview === "string" ? content.preview : "";
    this.timeRangeStart = typeof content.time_range_start === "string" ? content.time_range_start : "";
    this.timeRangeEnd = typeof content.time_range_end === "string" ? content.time_range_end : "";
    this.summaryMode = Number(content.summary_mode) || 1;
    this.spaceId = typeof content.space_id === "string" ? content.space_id : "";
  }
}

export class SummaryCardForwardBlockedError extends Error {
  constructor() {
    super("summary share cards cannot be forwarded without creating a new grant");
    this.name = "SummaryCardForwardBlockedError";
  }
}

export default SummaryCardContent;
