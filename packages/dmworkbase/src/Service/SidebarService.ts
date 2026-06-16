import APIClient from "./APIClient"

/** target_type 枚举: 1=DM, 2=群, 5=子区 */
export const SidebarTargetType = {
    DM: 1,
    CHANNEL: 2,
    THREAD: 5,
} as const

/** 后端 SidebarItem (modules/message/api_sidebar.go) */
export interface SidebarItem {
    target_type: number
    target_id: string
    channel_type: number
    channel_id: string
    timestamp: number
    unread: number
    is_pinned: boolean
    is_followed: boolean
    /** 关注分组 UUID（VARCHAR(32)），未分类为 null/缺失 */
    category_id?: string | null
    /** group_category.sort（类别之间排序权重） */
    category_sort?: number
    /** group_setting.follow_sort（手动排序权重） */
    follow_sort?: number
    /** 子区携带，指向父群 channelID */
    parent_channel_id?: string
    /** 仅子区(target_type=5)携带：1=active, 2=archived。
     *  缺失=状态未知（旧后端 / 非子区），消费方应回退到 channelInfo。 */
    status?: number
}

export interface SidebarSyncReq {
    tab: "follow" | "recent"
    /** IM 会话游标；首次/全量同步传 0 */
    version?: number
    /** IM last_msg_seqs 透传字段；首次/全量同步传 "" */
    last_msg_seqs?: string
    /** 单会话拉取的消息条数；sidebar 只需 timestamp/unread，1 即可 */
    msg_count?: number
    /** 客户端设备 UUID（必填，后端 validateSidebarRequest 校验非空） */
    device_uuid: string
}

export interface SidebarSyncResp {
    items: SidebarItem[]
    /** IM 会话游标，下次增量同步回传 */
    version: number
    /** user_follow_version 当前值，作为 follow tab 的 CAS / 增量检测锚 */
    follow_version: number
}

const SidebarService = {
    /** Sidebar 聚合同步：返回 follow / recent tab 所需的 items 与 follow_version */
    sync(req: SidebarSyncReq): Promise<SidebarSyncResp> {
        return APIClient.shared.post("/sidebar/sync", {
            tab: req.tab,
            version: req.version ?? 0,
            last_msg_seqs: req.last_msg_seqs ?? "",
            msg_count: req.msg_count ?? 1,
            device_uuid: req.device_uuid,
        }) as Promise<SidebarSyncResp>
    },
}

export default SidebarService
