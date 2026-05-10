/**
 * IM 消息查询 API — 对接 dmworkim 服务。
 *
 * 跟 matters 服务的 todoApi.ts 区分: matters 用独立 axios 实例 (baseURL='' +
 * '/matter/api/v1'), 这里用 WKApp.apiClient (baseURL='/api/v1/', 带 token +
 * X-Space-Id 拦截器), 不能混用。
 *
 * 后端路由定义见 dmworkim modules/message/api.go:315-323 + api_message_get.go。
 *
 * 注意事项:
 *   - message_id 是 int64 的字符串形式, 务必当 string 传, 不能用 number
 *     (JS number 最大安全整数 2^53-1, int64 会丢精度)
 *   - 任何不可见场景 (消息删除/撤回/非群成员/群解散等) 后端统一返回 404, 不
 *     泄露 "存在但不可达" 的信息。UI 只需要区分成功 / 失败展示
 *   - thread 接口受后端 DM_THREAD_ON 特性开关, 关闭时该路由不注册 → 404
 */

import { WKApp } from '@octo/base';

// ─── Response types (对齐 modules/message/api.go:2468 MsgSyncResp) ──────

export interface IMMessageHeader {
    no_persist?: boolean;
    red_dot?: boolean;
    sync_once?: boolean;
}

export interface IMMessageResp {
    header: IMMessageHeader;
    setting: number;
    message_id: number; // int64, 但 JS 中可能精度丢失, 展示用 message_idstr
    message_idstr: string;
    message_seq: number;
    client_msg_no: string;
    stream_no?: string;
    from_uid: string;
    from_is_external: 0 | 1;
    from_source_space_name?: string;
    from_home_space_id?: string;
    from_home_space_name?: string;
    to_uid?: string;
    channel_id: string;
    channel_type: number; // 2=Group, 5=CommunityTopic
    expire?: number;
    /** 服务端时间戳, 10 位秒级 */
    timestamp: number;
    payload: Record<string, unknown>;
    signal_payload?: string;
    reply_count?: number;
    reply_count_seq?: string;
    reply_seq?: string;
    reactions?: Array<{
        seq: number;
        uid: string;
        name: string;
        emoji: string;
        is_deleted: number;
        created_at: string;
    }>;
    is_deleted: 0 | 1;
    voice_status?: number;
    streams?: unknown[];
    readed: 0 | 1;
    revoke?: 0 | 1;
    revoker?: string;
    readed_count?: number;
    unread_count?: number;
    extra_version: number;
    message_extra?: Record<string, unknown>;
}

// ─── API functions ──────────────────────────────────────

/**
 * 查询群单条消息。
 *
 * 路径: GET /v1/groups/{group_no}/messages/{message_id}
 * 鉴权: 调用方必须是该群的活跃成员 (非拉黑)。
 *
 * @param groupNo   群编号 (32 位 hex)
 * @param messageId 消息 ID 字符串 (int64)
 * @returns 成功返回消息对象; 任何不可见场景 axios 会在 404 时 reject
 */
export async function getGroupMessage(
    groupNo: string,
    messageId: string,
): Promise<IMMessageResp> {
    return WKApp.apiClient.get<IMMessageResp>(
        `groups/${groupNo}/messages/${encodeURIComponent(messageId)}`,
    );
}

/**
 * 查询子区单条消息。
 *
 * 路径: GET /v1/groups/{group_no}/threads/{short_id}/messages/{message_id}
 * 鉴权: 调用方必须是父群的活跃成员, 且子区未删除。
 *
 * ⚠️ 后端 feature flag DM_THREAD_ON 未开启时该路由不存在, 会返回 404。
 */
export async function getThreadMessage(
    groupNo: string,
    shortId: string,
    messageId: string,
): Promise<IMMessageResp> {
    return WKApp.apiClient.get<IMMessageResp>(
        `groups/${groupNo}/threads/${shortId}/messages/${encodeURIComponent(messageId)}`,
    );
}

/**
 * 按 channel 类型分发到对应接口。
 *
 * - channel_type=2 (Group)              → getGroupMessage
 * - channel_type=5 (CommunityTopic/子区) → getThreadMessage, channel_id 形如
 *   "{groupNo}@{shortId}" (thread.BuildChannelID), 调用前需自行解析
 * - 其它类型 (Person/DM 等): 本接口族不覆盖, 抛错让调用方提示用户
 */
export async function getMessageByChannel(args: {
    channelId: string;
    channelType: number;
    messageId: string;
}): Promise<IMMessageResp> {
    const { channelId, channelType, messageId } = args;
    if (channelType === 2) {
        return getGroupMessage(channelId, messageId);
    }
    if (channelType === 5) {
        // thread.BuildChannelID 格式: "{groupNo}____{shortId}"
        // 分隔符是 4 个下划线, 见 dmworkim modules/thread/const.go
        // ChannelIDSeparator = "____"
        const SEP = '____';
        const at = channelId.indexOf(SEP);
        if (at <= 0 || at + SEP.length >= channelId.length) {
            throw new Error(`invalid thread channel_id: ${channelId}`);
        }
        const groupNo = channelId.slice(0, at);
        const shortId = channelId.slice(at + SEP.length);
        return getThreadMessage(groupNo, shortId, messageId);
    }
    throw new Error(`unsupported channel_type ${channelType} for message lookup`);
}
