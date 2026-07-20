/**
 * sendContentProxy — pre-send wire-payload injection
 * =====================================================
 *
 * 业务背景：`ConversationVM.sendMessage` 在把消息交给
 * `WKSDK.chatManager.send()` 之前，需要往 wire payload 注入两类
 * 业务字段：
 *
 *   1. **space_id**（仅 DM / ChannelTypePerson）—— `filterPersonMessagesBySpace`
 *      (#784) 依赖。BotFather 等 Bot 用此判断用户当前 Space。
 *
 *   2. **mention.humans / mention.ais / mention.entities**（任意 channel）——
 *      `wukongimjssdk@1.3.5` 的 `MessageContent.encode()` 写 mention 时
 *      只取 `this.mention.all` / `this.mention.uids`，**整段覆盖**
 *      `contentObj.mention`：
 *
 *      ```js
 *      // SDK encode() 节选
 *      var contentObj = this.encodeJSON();
 *      if (this.mention) {
 *          var mentionObj = {};
 *          if (this.mention.all)  mentionObj["all"]  = 1;
 *          if (this.mention.uids) mentionObj["uids"] = this.mention.uids;
 *          contentObj["mention"] = mentionObj;  // ← 整段覆盖
 *      }
 *      ```
 *
 *      所以仅靠 `encodeJSON` 注入 `mention.humans|ais|entities` 不够——
 *      SDK encode 后仍会被覆盖。必须在 `encode()` 的 wire bytes 出炉后做
 *      post-process（decode-modify-encode）才能保住这些字段。
 *
 *      群聊里发 "@所有AI" 时若不修复，server 端收不到 `mention.ais=1`，
 *      AI bot 不响应。参考 octo-web#62 / YUJ-1378。
 *
 * 注入策略：**不修改原始 content 对象**。原因是同一个 content 在转发场景下
 * 可能被多次复用（多目标转发）或是原始消息的引用（单条转发），直接
 * monkey-patch 会污染原始消息。
 *
 * 实现：创建一个 `Object.create(content)` 代理对象，覆盖 `encodeJSON` /
 * `encode` / `contentObj` 三个序列化入口：
 *   - `encodeJSON()` 注入两个字段（mention 字段虽然会被 SDK encode 覆盖，
 *     但直接调用 encodeJSON 的代码路径需要看到三态字段，保持一致性）。
 *   - `encode()` 通过 swap-call-restore 让 SDK 调用我们的 encodeJSON
 *     拿到 space_id，然后再对 SDK 返回的 bytes 做 mention.humans|ais 的
 *     post-process re-inject。
 *   - `contentObj` 用于本地回显（messageToMap），也要带上注入字段。
 *
 * 提取出来是为了 unit test —— 整个 `Conversation/vm.ts` 引了 Mergeforward
 * 等重量级 UI 模块，在 jsdom 里 import 会触发 lottie / canvas 报错。
 * 这个 helper 只依赖 wukongimjssdk 的 MessageContent 类型，干净可测。
 */

import type { MessageContent } from "wukongimjssdk"

/**
 * MessageContent 上业务层扩展的字段（SDK 类型未暴露，但运行时存在）。
 * 抽出命名类型让本文件里的 `as` 收敛到几处、签名可读。
 */
interface MentionShape {
    all?: number | boolean
    uids?: string[]
    humans?: number | boolean
    ais?: number | boolean
    entities?: unknown[]
}
type MentionAware = { mention?: MentionShape }
type ContentObjAware = { contentObj?: Record<string, any> & { mention?: MentionShape } }
type ExtendedContent = MessageContent & MentionAware & ContentObjAware

/**
 * 描述本次发送需要注入哪些字段。
 *
 * `spaceId` 为非空字符串时注入 `obj.space_id`。
 * `mentionHumans` / `mentionAis` 为 truthy 时注入 `obj.mention.humans|ais=1`。
 */
export interface SendInjection {
    spaceId?: string | null
    mentionHumans?: boolean
    mentionAis?: boolean
}

/**
 * 给 `content` 套一层注入业务字段的代理。若 `injection` 没有任何要注入的
 * 字段，原样返回 `content`（无开销、no-op）。
 *
 * 返回的对象是 `Object.create(content)` 出来的轻量代理，原 content 不被
 * mutate；调用方拿到的 sendContent.encode() 包含注入字段，
 * sendContent.contentObj 也带注入字段（本地回显用）。
 */
export function wrapSendContentForInjection(
    content: MessageContent,
    injection: SendInjection,
): MessageContent {
    const ext = content as ExtendedContent
    const injectSpaceId = !!injection.spaceId
    const injectMentionHumans = !!injection.mentionHumans
    const injectMentionAis = !!injection.mentionAis
    const mentionRoot = ext.mention?.entities
    const mentionInContentObj = ext.contentObj?.mention?.entities
    const mentionEntities =
        Array.isArray(mentionRoot) && mentionRoot.length > 0
            ? mentionRoot
            : Array.isArray(mentionInContentObj) && mentionInContentObj.length > 0
              ? mentionInContentObj
              : undefined
    const injectMentionEntities = !!mentionEntities
    const injectMention = injectMentionHumans || injectMentionAis || injectMentionEntities
    if (!injectSpaceId && !injectMention) {
        return content
    }

    const sendContent: MessageContent = Object.create(content) as MessageContent
    // 保存原始 encodeJSON 的引用（不 bind），通过 .call(this) 传 receiver，
    // 让 media 上传后写到代理的 url/remoteUrl 能被正确读取。
    const originalEncodeJSON = content.encodeJSON
    sendContent.encodeJSON = function (this: any) {
        const obj = originalEncodeJSON.call(this)
        if (injectSpaceId) {
            obj.space_id = injection.spaceId
        }
        // 注：mention 在 encodeJSON 这里注入只对 *直接调用 encodeJSON()*
        // 的代码路径生效。SDK encode() 后续会用 this.mention 重新覆盖
        // contentObj.mention（见文件 header）。真正进 wire 的注入由
        // 下面 encode() 的 post-process 完成。这里同步写一份只是保持
        // 不同入口的输出一致。
        if (injectMention) {
            if (!obj.mention) obj.mention = {}
            if (injectMentionEntities) obj.mention.entities = mentionEntities
            if (injectMentionHumans) obj.mention.humans = 1
            if (injectMentionAis) obj.mention.ais = 1
        }
        return obj
    }
    // encode() 覆盖：解决三个矛盾需求：
    // 1. mention 实例级 encode 覆盖 bind 了 content，需要 encodeJSON 在 content 上
    //    （swap-call-restore content.encodeJSON 让 space_id 注入生效）
    // 2. media 上传后 SDK 把 remoteUrl/url 写到 sendContent（代理）上
    //    （ownKeys 同步回 content，调用完再 restore）
    // 3. SDK 的 MessageContent.encode 用 `this.mention` 整段覆盖 contentObj.mention
    //    （拿到 bytes 后 decode-modify-encode 补回 humans/ais）
    sendContent.encode = function () {
        // 前置条件（swap-call-restore 安全性依赖）：
        // 1. content.encode() 必须是同步的（无 await），否则 swap 窗口内可被其他调用打断
        // 2. content.encode() 不会递归调用 ConversationVM.sendMessage
        // 当前 SDK (wukongimjssdk 1.3.5) 满足这两个条件。
        //
        // 同步 media 上传后写入代理的属性回原始 content，
        // 跟踪 hasOwnProperty 以正确恢复（避免 own-property 泄漏）。
        const ownKeys = Object.getOwnPropertyNames(sendContent)
        const saved: Record<string, any> = {}
        const hadOwn: Record<string, boolean> = {}
        for (const key of ownKeys) {
            if (key === "encodeJSON" || key === "encode" || key === "contentObj") continue
            hadOwn[key] = Object.prototype.hasOwnProperty.call(content, key)
            if (hadOwn[key]) saved[key] = (content as any)[key]
            ;(content as any)[key] = (sendContent as any)[key]
        }
        // swap encodeJSON 让 space_id 注入生效
        const savedEncodeJSON = content.encodeJSON
        const hadOwnEncodeJSON = Object.prototype.hasOwnProperty.call(content, "encodeJSON")
        content.encodeJSON = sendContent.encodeJSON
        let bytes: Uint8Array
        try {
            bytes = content.encode.call(content)
        } finally {
            if (hadOwnEncodeJSON) content.encodeJSON = savedEncodeJSON
            else delete (content as any).encodeJSON
            // 恢复 content 上被同步过去的属性
            for (const key of Object.keys(hadOwn)) {
                if (hadOwn[key]) (content as any)[key] = saved[key]
                else delete (content as any)[key]
            }
        }
        // SDK encode 之后再 post-process mention.humans / mention.ais ——
        // SDK encode 会把它们 strip 掉，这里 decode bytes 后回填，再 re-encode。
        // 若 JSON parse 失败（理论不会，SDK 必出合法 JSON）则退回原 bytes，
        // 保证发送不被这里 block。
        if (injectMention) {
            try {
                const str = new TextDecoder().decode(bytes)
                const obj = JSON.parse(str)
                if (!obj.mention) obj.mention = {}
                if (injectMentionEntities) obj.mention.entities = mentionEntities
                if (injectMentionHumans) obj.mention.humans = 1
                if (injectMentionAis) obj.mention.ais = 1
                bytes = new TextEncoder().encode(JSON.stringify(obj))
            } catch (e) {
                // 静默 fallback：发送原 bytes，至少消息能发出去
                // eslint-disable-next-line no-console
                console.warn("[sendContentProxy] mention re-inject failed", e)
            }
        }
        return bytes
    }
    // 同步 contentObj，让本地回显也走带注入字段的路径
    // （filterPersonMessagesBySpace #784 依赖 space_id；
    //  本地 mention 渲染依赖 mention.humans|ais 的存在）
    // 当原始 contentObj 为空时（新创建的消息未经 decode），用 encodeJSON()
    // 构建完整 payload，避免本地回显的 contentObj 只有少量字段、
    // 导致 messageToMap 丢失实际内容。
    const baseObj = content.contentObj || { ...content.encodeJSON(), type: content.contentType }
    const mergedObj: Record<string, any> = { ...baseObj }
    if (injectSpaceId) {
        mergedObj.space_id = injection.spaceId
    }
    if (injectMention) {
        mergedObj.mention = { ...(mergedObj.mention || {}) }
        if (injectMentionEntities) mergedObj.mention.entities = mentionEntities
        if (injectMentionHumans) mergedObj.mention.humans = 1
        if (injectMentionAis) mergedObj.mention.ais = 1
    }
    sendContent.contentObj = mergedObj
    return sendContent
}
