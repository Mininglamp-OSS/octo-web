import { InteractiveCardContent } from "./InteractiveCardContent";

/** remoteExtra 的最小结构（编辑帧）。contentEdit 由 SDK 按 type 解码为 MessageContent 实例。 */
export interface EditableRemoteExtra {
  isEdit?: boolean;
  contentEdit?: unknown;
}

/**
 * 择优返回卡片的「有效渲染帧」。
 *
 * bot 通过 /v1/bot/message/edit 改卡后，服务端把新帧写进 message_extra(content_edit) 并
 * 广播 CMDSyncMessageExtra；客户端拉增量后写回 `remoteExtra`（Convert.toMessageExtra 已按
 * type=17 解码成 InteractiveCardContent 实例）。渲染时须择优用编辑帧，否则仍显示原始卡。
 *
 * fail-safe：仅当 isEdit 且 contentEdit 确为 InteractiveCardContent 实例时才采用；
 * 否则回退原始 content（防御异常/类型不符的编辑帧）。
 */
export function resolveEffectiveCardContent(
  content: InteractiveCardContent,
  remoteExtra: EditableRemoteExtra | undefined
): InteractiveCardContent {
  if (
    remoteExtra?.isEdit &&
    remoteExtra.contentEdit instanceof InteractiveCardContent
  ) {
    return remoteExtra.contentEdit;
  }
  return content;
}
