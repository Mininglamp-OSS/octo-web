/**
 * 共享 realname-badge 判定 helper。
 *
 * 当前使用者：
 *   - bridge 路径：`src/bridge/message/useMessageRow.ts`
 *   - legacy 路径：`src/Messages/Base/index.tsx`
 *
 * src/Messages/Base/ 中的某些消息类型（Voice / Gif / Location / File / Video）
 * 仍走 MessageBase 而未迁到新 MessageRow。为避免功能分裂，两条路径需要调用本
 * helper 保持一致的实名徽章判定逻辑。规则改动请同步两处。
 *
 * ## 规则（按顺序，短路）
 *
 *   1. `isAi` → false（AI 消息一律不展示徽章）。
 *   2. `isBotConversation` → false（Round 3）。
 *      "当前会话是 bot 私聊" 应按 **会话 channel**（`message.channel`，即对方
 *      那一头，Person 1v1 时就是 bot 自己，群时是群）判断，而不是按 **发送者**
 *      的 Person channelInfo 判（R1/R2 的 `channelInfo?.orgData?.robot===1`
 *      是按 `message.fromUID` 查的，自己发给 bot 的消息 fromUID=自己 → 查到
 *      "自己"的 Person channelInfo → robot≠1 → 判不成 bot → self-fallback
 *      命中，导致「自己发给 bot 的消息错误显示实名 ✓」，Jerry R2 🔴 Critical）。
 *   3. `isBotSender` → false（群里 bot 作为 fromUID 时的原规则保留：
 *      群成员 orgData 若异常带 realname_verified=true，也不应让 bot 发送者
 *      渲染徽章）。`isBotConversation` 和 `isBotSender` 是两个维度：
 *        - `isBotConversation`：会话是不是 bot 1v1（自己和别人发都应抑制）；
 *        - `isBotSender`：消息的发送者是不是 bot（群里 bot 发送应抑制）。
 *   4. 群成员 orgData 已实名 → true（群消息主路径，命中率最高）。
 *   5. Person channelInfo.orgData 已实名 → true（1v1 或群成员未同步时的回落）。
 *   6. self-fallback：`isOwnMessage && loginRealnameVerified === true` → true。
 *        - 客户端群成员订阅通常不缓存自己；channelInfo.orgData 也不带
 *          realname_verified。必须 `=== true` 严格比较，tri-state 不能放行
 *          undefined（Phase A 血泪教训）。
 *   7. 其他 → false。
 */

import { isRealnameVerified } from "./displayName";

export interface ShouldShowRealnameBadgeArgs {
    /** AI 发送者（从 isAiMessage 得出） */
    isAi: boolean;
    /**
     * 是否当前会话是 bot 1v1 私聊。
     * 由调用方通过 **message.channel** 对应的 channelInfo.orgData.robot===1 推出，
     * 不要用发送者的 Person channelInfo 判断（fromUID 路径对 self 无效）。
     */
    isBotConversation: boolean;
    /**
     * 消息的发送者是不是 bot。
     * 调用方可通过群成员 orgData.robot 或 fromUID 对应 Person channelInfo.orgData.robot 推出。
     * 群里 bot 发送时保留原规则：即便 groupMember.realname_verified=true 也不显示徽章。
     */
    isBotSender: boolean;
    isOwnMessage: boolean;
    groupMemberOrgData?: unknown;
    channelInfoOrgData?: unknown;
    loginRealnameVerified?: boolean;
}

export function shouldShowRealnameBadge(args: ShouldShowRealnameBadgeArgs): boolean {
    if (args.isAi) return false;
    if (args.isBotConversation) return false;
    if (args.isBotSender) return false;
    if (isRealnameVerified(args.groupMemberOrgData as any)) return true;
    if (isRealnameVerified(args.channelInfoOrgData as any)) return true;
    return args.isOwnMessage && args.loginRealnameVerified === true;
}
