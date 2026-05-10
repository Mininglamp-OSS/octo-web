// Matter module type definitions — aligned with matters service backend models.
// Frontend uses Matter types naming for backwards compatibility at the UI layer;
// the wire types match the backend Matter* structs.

// ─── Status enums ───────────────────────────────────────

export type MatterStatus = "open" | "done" | "archived";

// ─── Core models (match backend JSON exactly) ───────────

/**
 * Matter — from model.Matter in matters service.
 *
 * 负责人字段 (assignees):
 *   - 详情接口 GET /matters/:id 返回 MatterDetail, 必然带 assignees
 *   - 列表接口 GET /matters 自 todos PR #36 起每项也带 assignees (空数组而非 null)
 *   - 类型上保留 optional, 兼容历史接口或异常响应
 */
export interface Matter {
  id: string;
  seq_no: number;
  space_id: string;
  title: string;
  description?: string;
  creator_id: string;
  status: MatterStatus;
  deadline?: string;
  remind_at?: string;
  source_channel_id?: string;
  source_channel_type?: number;
  source_name?: string;
  assignees?: MatterAssignee[];
  created_at: string;
  updated_at: string;
}

/**
 * MatterDetail — from service.MatterDetail, returned by GET /matters/:id and POST /matters.
 * Extends Matter with assignees, participants, and linked channels.
 */
export interface MatterDetail extends Matter {
  assignees: MatterAssignee[];
  participants?: string[];
  channels?: MatterChannel[];
}

export interface MatterAssignee {
  id: string;
  matter_id: string;
  user_id: string;
  created_at: string;
}

export interface MatterChannel {
  id: string;
  matter_id: string;
  channel_id: string;
  channel_type: number;
  channel_name?: string;
  linked_by: string;
  created_at: string;
}

export interface TimelineAttachment {
  id: string;
  entry_id: string;
  file_url: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
}

export interface TimelineEntry {
  id: string;
  matter_id: string;
  user_id: string;
  content: string | null;
  channel_id?: string;
  channel_type?: number;
  source_channel_id?: string;
  source_msgs?: string[];
  related_uids?: string[];
  created_at: string;
  attachments?: TimelineAttachment[];
}

/** @deprecated 使用 TimelineEntry 替代 */
export type MatterComment = TimelineEntry;
/** @deprecated 使用 TimelineAttachment 替代 */
export type CommentAttachment = TimelineAttachment;

// ─── Pagination ─────────────────────────────────────────

export interface Pagination {
  has_more: boolean;
  next_cursor?: string;
}

export interface PaginatedList<T> {
  data: T[];
  pagination: Pagination;
}

// ─── Request types ──────────────────────────────────────

export interface MatterListParams {
  status?: MatterStatus;
  assignee_id?: string;
  creator_id?: string;
  /**
   * 按来源频道过滤 (OR 扩展可见性):
   * 后端在 visibility 子句里多加一条 OR: 当前用户在该 channel 且 matter 关联了该
   * channel。返回结果是 "本群关联的 ∪ 我发起/我负责/我参与的" 并集, 不会缩小集合。
   * 需要严格 "只要本群关联的", 用 channel_id。
   */
  source_channel_id?: string;
  /** 按来源频道类型 (matters.source_channel_type) 严格 AND 过滤 */
  source_channel_type?: number;
  /**
   * 严格按 channel 过滤 (AND): 只返回通过 matter_channels 关联到该 channel 的
   * Matter。跟 source_channel_id 的关键区别是这条是 AND 而非 OR, 不会混入
   * "我相关但跟本群无关" 的 Matter。后端同样做 IM 成员验证 (非群成员传了会被
   * 忽略, 返回集合降级到可见性集合)。
   * 匹配原型 PRD §11 "当前 channel/thread 关联的所有 Matter" 的语义。
   */
  channel_id?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateMatterReq {
  title: string;
  description?: string;
  assignee_ids?: string[];
  source_channel_id?: string;
  source_channel_type?: number;
  source_name?: string;
  deadline?: string;
  remind_at?: string;
}

export interface UpdateMatterReq {
  title?: string;
  description?: string | null;
  deadline?: string | null;
  remind_at?: string | null;
}

// ─── Extract (AI 智能创建) ──────────────────────────────

export interface ExtractMessageAttachment {
  file_name: string;
  file_url: string;
}

export interface ExtractMessage {
  message_id: string;
  from_uid: string;
  from_uname?: string;
  timestamp?: number;
  content?: string;
  attachments?: ExtractMessageAttachment[];
}

export interface ExtractMatterReq {
  channel_type: number;
  channel_id: string;
  channel_name?: string;
  creator_uid: string;
  msgs: ExtractMessage[];
}

export interface ExtractResult {
  id: string;
  seq_no: number;
  title: string;
  description: string;
  source_msgs: string[];
  deadline?: number | null;
  status: string;
  created_at: string;
}

// ─── Timeline ───────────────────────────────────────────

export interface TimelineAttachmentReq {
  file_url: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

export interface TimelineReq {
  content?: string;
  attachments?: TimelineAttachmentReq[];
  channel_id?: string;
  channel_type?: number;
  channel_name?: string;
  participant_uid?: string;
  msgs?: ExtractMessage[];
}

/** @deprecated 使用 TimelineAttachmentReq 替代 */
export type CommentAttachmentReq = TimelineAttachmentReq;
/** @deprecated 使用 TimelineReq 替代 */
export type AddCommentReq = TimelineReq;

export interface LinkChannelReq {
  channel_id: string;
  channel_type: number;
  channel_name?: string;
}

export interface ListCommentsParams {
  source_channel_id?: string;
  limit?: number;
  cursor?: string;
}

// ─── API error ──────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
