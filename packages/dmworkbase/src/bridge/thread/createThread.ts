import WKApp from "../../App"
import ThreadService, { type ThreadCreateResult } from "../../Service/ThreadService"
import { buildThreadChannelId, parseThreadChannelId, type Thread } from "../../Service/Thread"
import { Dap } from "../../Service/Dap"
import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../Service/Const"

export async function createThreadByNameAndNotify(
  groupNo: string,
  name: string,
  sourceMessageId?: number
): Promise<ThreadCreateResult> {
  const result = await ThreadService.createThreadByName(groupNo, name, sourceMessageId)
  emitThreadCreated(groupNo, result)
  // 顶栏创建子区：不带 from_msg_type（空值策略）
  trackSubchannelCreated(result, 'channel_toolbar', { title: name })
  return result
}

export function emitThreadCreated(groupNo: string, thread: ThreadCreateResult) {
  const shortId = thread.short_id
  const threadChannelId = thread.channel_id || (shortId ? buildThreadChannelId(groupNo, shortId) : undefined)
  if (!threadChannelId) return

  WKApp.mittBus.emit("wk:thread-created", {
    groupNo,
    shortId,
    threadChannelId,
    thread: thread as Thread,
  })
}

/**
 * 推断消息类型用于 subchannel_created 的 from_msg_type 属性。
 * 映射到 CSV:26 规范值：'text' | 'reply' | 'image_file' | 'link'
 */
export function inferMsgType(message: any): 'text' | 'reply' | 'image_file' | 'link' | undefined {
  const contentType = message?.contentType
  if (contentType === MessageContentType.text || contentType === MessageContentTypeConst.richText) {
    return 'text'
  }
  if (contentType === MessageContentType.image) {
    return 'image_file'
  }
  // reply 判断：如果有 reply 相关字段（根据实际消息结构调整）
  if (message?.reply?.messageID || message?.quote?.messageID) {
    return 'reply'
  }
  // link 判断：如果是链接卡片或包含 URL
  if (contentType === MessageContentTypeConst.interactiveCard) {
    return 'link'
  }
  return undefined
}

/**
 * 子区创建成功后的埋点 helper。
 *
 * typecheck 安全写法：ThreadCreateResult.channel_id 可选，parseThreadChannelId() 入参要 string，
 * strict 开着。subchannel_id 取值为：resp.short_id ?? parsedShortId ?? resp.channel_id，
 * 三者都取不到则不发。
 *
 * @param resp - ThreadCreateResult
 * @param source - 'channel_toolbar' | 'message_right_click'（CSV:26 规范值）
 * @param meta - { fromMsgType?: 'text' | 'reply' | 'image_file' | 'link', title?: string }
 */
export function trackSubchannelCreated(
  resp: ThreadCreateResult,
  source: 'channel_toolbar' | 'message_right_click',
  meta: { fromMsgType?: 'text' | 'reply' | 'image_file' | 'link'; title?: string }
): void {
  // typecheck 安全：channel_id 可选，parseThreadChannelId 入参要 string
  const parsedShortId = resp.channel_id
    ? parseThreadChannelId(resp.channel_id)?.shortId
    : undefined
  const subchannelId = resp.short_id ?? parsedShortId ?? resp.channel_id
  if (!subchannelId) return

  // title_len_bucket 按 title.length 分 empty/short(≤10)/medium(≤30)/long
  let titleLenBucket: string
  if (!meta.title) {
    titleLenBucket = 'empty'
  } else if (meta.title.length <= 10) {
    titleLenBucket = 'short'
  } else if (meta.title.length <= 30) {
    titleLenBucket = 'medium'
  } else {
    titleLenBucket = 'long'
  }

  const props: Record<string, unknown> = {
    subchannel_id: subchannelId,
    source,
    title_len_bucket: titleLenBucket,
  }
  // from_msg_type 空值策略：顶栏路径不发该字段（空值，非 'none'）；右键路径用 inferMsgType 映射
  if (meta.fromMsgType) {
    props.from_msg_type = meta.fromMsgType
  }

  Dap.shared.track('subchannel_created', props)
}
