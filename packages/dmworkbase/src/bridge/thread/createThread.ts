import WKApp from "../../App"
import ThreadService, { type ThreadCreateResult } from "../../Service/ThreadService"
import { buildThreadChannelId, parseThreadChannelId, type Thread } from "../../Service/Thread"
import { Dap } from "../../Service/Dap"
import { stripSpacePrefix } from "../../Service/SpacePrefix"
import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../Service/Const"

export async function createThreadByNameAndNotify(
  groupNo: string,
  name: string,
  sourceMessageId?: number
): Promise<ThreadCreateResult> {
  const result = await ThreadService.createThreadByName(groupNo, name, sourceMessageId)
  emitThreadCreated(groupNo, result)
  // source 恒 'channel_toolbar':本 bridge 的三个调用方(ThreadPanel / ThreadCreate / ThreadCreateModal)
  // 生产环境均不传 sourceMessageId(ThreadList 为死组件、ThreadCreateModal 无生产实例),
  // 「带 sourceMessageId 即右键」的推断在生产不可达且语义有损(有源消息 ≠ 来自右键菜单)。
  // 真右键路径走 module.tsx 的 createThreadFromMessage,自带显式 'message_right_click' 埋点,不经此桥。见 #1452 review P2。
  trackSubchannelCreated(result, 'channel_toolbar', { title: name, channelId: groupNo })
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
 * 映射到当前可创建子区消息对应的 CSV:26 规范值。
 */
export function inferMsgType(message: any): 'text' | 'reply' | 'image_file' | undefined {
  const contentType = message?.content?.contentType ?? message?.contentType
  // reply 优先:回复类消息即便正文是文本,也应归类为 'reply'(CSV:26)。reply 元数据
  // 在 content.reply(MessageContent.reply),不在 message 顶层——旧代码查 message.reply
  // /message.quote 永远取不到值,故 reply 分支从不触发(见 Conversation/vm.ts:1535 的
  // message.content.reply.messageID 读法)。
  if (message?.content?.reply?.messageID) {
    return 'reply'
  }
  if (contentType === MessageContentType.text || contentType === MessageContentTypeConst.richText) {
    return 'text'
  }
  // image(图片)与 file(文件, MessageContentTypeConst.file=8)同归 image_file 桶。
  if (contentType === MessageContentType.image || contentType === MessageContentTypeConst.file) {
    return 'image_file'
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
 * @param meta - { fromMsgType?: 'text' | 'reply' | 'image_file' | 'link', title?: string, channelId?: string }
 *   channelId = 子区所属**父群** channelID（spec 关键属性 channel_id，非新建子区 id）。
 */
export function trackSubchannelCreated(
  resp: ThreadCreateResult | null | undefined,
  source: 'channel_toolbar' | 'message_right_click',
  meta: { fromMsgType?: 'text' | 'reply' | 'image_file' | 'link'; title?: string; channelId?: string }
): void {
  // fail-closed:埋点绝不能改变业务行为。createThreadFromMessage 直接返回未 normalize 的
  // 裸 API 结果(不同于走 normalizeThreadCreateResult 的 createThreadByName),2xx 空 body 时
  // resp 可能为 null;若在此解引用 resp.channel_id 抛 TypeError,会被调用方的 try 吞掉,
  // 把一次「子区已建成」误判为「创建失败」。故 helper 自身对空值早返回,覆盖全部调用点。
  if (!resp) return
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
  // spec 关键属性 channel_id = 父群 channelID（两个调用点各自传入；无则不发，避免 undefined）。
  // 归一 bare id(stripSpacePrefix):与本 PR 其余新事件同一 channel_id 口径,Space 部署下可跨事件 join。
  if (meta.channelId) {
    props.channel_id = stripSpacePrefix(meta.channelId)
  }
  // from_msg_type 空值策略：顶栏路径不发该字段（空值，非 'none'）；右键路径用 inferMsgType 映射
  if (meta.fromMsgType) {
    props.from_msg_type = meta.fromMsgType
  }

  Dap.shared.track('subchannel_created', props)
}
