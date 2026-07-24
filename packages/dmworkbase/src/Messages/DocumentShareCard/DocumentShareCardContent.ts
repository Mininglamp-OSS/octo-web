import { MessageContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { t } from "../../i18n";
import { asDocIdentifier } from "./docIdentity";

/** 转发的资源类型。与 docs 后端 /d/:docId 的三条内容线对应。 */
export type DocShareKind = "doc" | "board" | "sheet";

/** 转发时授予接收者的权限（forwardGrant 的结果，只承载展示语义）。 */
export type DocSharePermission = "reader" | "writer";

const KINDS: DocShareKind[] = ["doc", "board", "sheet"];
const PERMISSIONS: DocSharePermission[] = ["reader", "writer"];

/** 从 unknown 安全取字符串（SDK decodeJSON 签名为 any，一律按 unknown 收窄）。 */
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asKind(v: unknown): DocShareKind {
  return typeof v === "string" && (KINDS as string[]).includes(v)
    ? (v as DocShareKind)
    : "doc";
}

function asPermission(v: unknown): DocSharePermission {
  return typeof v === "string" && (PERMISSIONS as string[]).includes(v)
    ? (v as DocSharePermission)
    : "reader";
}

/**
 * 文档转发卡片正文（contentType=18）。
 *
 * 这是一个**自定义内容类型**（对标 SummaryCardContent=15 / MergeforwardContent=11），
 * 由转发者本人的客户端构造并发送——因此不同于 type-17 互动卡（仅机器人/webhook 可发、
 * 渲染前有发送者信任门），本卡片渲染端**不做发送者信任门控**，署名即转发者本人。
 *
 * payload 只承载**资源身份 + 转发时授予的权限**；首屏预览不入消息体——它必须按每个
 * 接收者各自的权限即时校验（ACL-safe），故由渲染 Cell 用宿主 apiClient 调 docs 后端
 * reader 接口（/content、/scene、/sheet）现取，无权限则接口 403/404、卡片落 no_access 态。
 */
export class DocumentShareCardContent extends MessageContent {
  /** 文档 id，映射 /d/{docId}?sp={spaceId}。 */
  docId = "";
  /** 文档所属 space id（预览与 deep-link 都要）。 */
  spaceId = "";
  /** 资源类型：doc/board/sheet。 */
  kind: DocShareKind = "doc";
  /** 转发时的文档标题快照（已由发送侧转义/截断）。 */
  title = "";
  /** 文档所有者展示名（转发侧预解析，可空）。 */
  ownerName = "";
  /** 预格式化的更新时间字符串（转发侧格式化，可空）。 */
  updatedAt = "";
  /** 可点击的文档链接（buildDocLink 生成，含 docId/spaceId）。 */
  url = "";
  /** 转发时授予接收者的权限（reader/writer），仅展示用途。 */
  permission: DocSharePermission = "reader";

  get contentType() {
    return MessageContentTypeConst.docShareCard;
  }

  /** 会话列表 / 引用预览摘要。 */
  get conversationDigest() {
    const title = this.title?.trim();
    return title
      ? t("base.message.digest.docShareCard", { values: { title } })
      : t("base.message.digest.docShareCardEmpty");
  }

  encodeJSON(): Record<string, unknown> {
    return {
      type: this.contentType,
      doc_id: this.docId,
      space_id: this.spaceId,
      kind: this.kind,
      title: this.title,
      owner_name: this.ownerName,
      updated_at: this.updatedAt,
      url: this.url,
      permission: this.permission,
    };
  }

  decodeJSON(content: any): void {
    const raw = (content ?? {}) as Record<string, unknown>;
    this.docId = asDocIdentifier(raw.doc_id);
    this.spaceId = asDocIdentifier(raw.space_id);
    this.kind = asKind(raw.kind);
    this.title = asString(raw.title);
    this.ownerName = asString(raw.owner_name);
    this.updatedAt = asString(raw.updated_at);
    this.url = asString(raw.url);
    this.permission = asPermission(raw.permission);
  }
}

export default DocumentShareCardContent;
