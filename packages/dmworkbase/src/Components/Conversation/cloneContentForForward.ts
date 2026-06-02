/**
 * cloneContentForForward — 为转发场景创建内容的安全克隆
 * =========================================================
 *
 * 问题背景 (octo-web#86):
 *
 * `fowardMessageUI` 和多选逐条转发原先直接复用原始 content 引用
 * （`getEffectiveContent` 返回 message.content 本身，非克隆）。
 * 这导致两个严重问题：
 *
 * 1. **MediaMessageContent.file 未清除 → 触发重新上传**
 *    用户自己发送的文件/图片/视频消息，上传完成后 SDK 不会清除
 *    content.file（原始 File 对象）。转发时 SDK 的 chatManager.send
 *    检测到 file 存在，走上传路径而非直接发送。上传使用目标 channel
 *    构造存储路径 (`/${channelType}/${channelID}/...`)，对于 thread
 *    目标 (channelType=5) 可能触发服务端 auto-create 行为，产生
 *    "幽灵子区"（unnamed ghost thread）。
 *
 * 2. **共享引用 → 多目标转发互相干扰**
 *    同一 content 对象在多个目标间复用，上传任务修改 content.url/
 *    remoteUrl 后影响后续目标的发送数据。
 *
 * 解决方案:
 *   - encode() → 新实例 decode() 往返一次，产出干净的独立拷贝
 *   - 清除 file（阻止不必要的重新上传）
 *   - 清除 reply（回复上下文不应带入目标会话）
 *   - 清除 mention（@提及不应带入目标会话）
 */

import { WKSDK, MessageContent, MediaMessageContent } from "wukongimjssdk"

/**
 * 为转发创建 content 的安全克隆。
 *
 * 返回一个与原始 content 类型相同、内容相同但完全独立的新实例：
 *   - 无 file 引用（阻止 SDK 重新上传）
 *   - 无 reply（回复上下文不带入目标会话）
 *   - 无 mention（@提及不带入目标会话）
 */
export function cloneContentForForward(content: MessageContent): MessageContent {
    // 1. encode 原始内容为 wire bytes (JSON)
    //    注意: MessageContent.encode() 会将 reply / mention 写入 JSON,
    //    decode 后这些字段会出现在克隆上, 下面需要手动清理。
    const encoded = content.encode()

    // 2. 根据 contentType 创建新实例并 decode
    const cloned = WKSDK.shared().getMessageContent(content.contentType)
    cloned.decode(encoded)

    // 3. 清理转发不需要的字段
    //    - file: 防止 SDK 走上传路径 (根因修复)
    //    - reply: 回复上下文不应带入目标会话
    //    - mention: @提及不应带入目标会话
    if (cloned instanceof MediaMessageContent) {
        ;(cloned as any).file = undefined
    }
    cloned.reply = undefined as any
    cloned.mention = undefined as any

    return cloned
}
