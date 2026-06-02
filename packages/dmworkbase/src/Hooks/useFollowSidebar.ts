import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import WKSDK, { ConversationAction, type Conversation, type ConversationListener } from "wukongimjssdk"
import WKApp from "../App"
import { t } from "../i18n"
import { ChannelTypeCommunityTopic } from "../Service/Const"
import SidebarService, { SidebarItem } from "../Service/SidebarService"
import { buildThreadChannelId, parseThreadChannelId } from "../Service/Thread"

export interface UseFollowSidebarResult {
    /** 已关注的 sidebar items（target_type 全集，is_followed=true 由后端保证） */
    items: SidebarItem[]
    /** target_type=1 (DM) 按 category_id 聚合 → peer_uid 列表 */
    dmsByCategory: Map<string, SidebarItem[]>
    /** target_type=5 (子区) 按 category_id 聚合 */
    threadsByCategory: Map<string, SidebarItem[]>
    /** 全类型按 category_id 聚合，每桶按 follow_sort ASC 排序。
     *  渲染关注 tab 时直接按此顺序铺，不要再按 timestamp 重排（否则手动排序结果不可见）。 */
    itemsByCategory: Map<string, SidebarItem[]>
    /** target_type=2 (群) 当前已关注的 group_no 集合。/categories 不感知 follow 状态，
     *  渲染时要跟这个 Set 求交才能反映真实关注关系。 */
    followedGroupNos: Set<string>
    /** 全类型已关注集合，key 为 `${target_type}::${target_id}`。
     *  右键菜单判定 isFollowed 时用，避免依赖不可靠的 channelInfo.orgData.is_followed
     *  （特别是子区，IM sync 不带这个字段）。 */
    followedKeys: Set<string>
    /** user_follow_version，下次 /v2/follow/sort CAS 时回传 */
    followVersion: number
    /** versionRef.current 始终跟最新 follow_version 同步，避免连续 sort 时
     *  闭包持有旧值导致 CAS 冲突。后端 sort 成功后调用 bumpVersion() 乐观自增。 */
    versionRef: React.MutableRefObject<number>
    /** sort 200 后立刻 +1（后端固定 bump 1），让下一次 sort 不必等 reload */
    bumpVersion: () => void
    /** 乐观更新：drop 那一刻立刻把指定 items 的 follow_sort 改成数组下标，
     *  避免等 API + reload 完成期间出现"item 回弹原位再闪到新位置"的视觉抖动。
     *  失败时由后续 reloadSidebar 兜底回退。 */
    applyOptimisticSort: (items: { target_type: number; target_id: string }[]) => void
    isLoading: boolean
    error: string | null
    reload: () => Promise<void>
}

const NULL_CATEGORY = ""
const THREAD_SIDEBAR_RELOAD_DELAYS_MS = [300, 1000, 2000]
type LoadOptions = { silent?: boolean }

export function shouldReloadFollowSidebarForThreadConversation(args: {
    conversation?: Conversation | null
    action: ConversationAction
    followedKeys: Set<string>
    followedGroupNos: Set<string>
    requestedThreadIds: Set<string>
}): boolean {
    const { conversation, action, followedKeys, followedGroupNos, requestedThreadIds } = args
    if (action !== ConversationAction.add && action !== ConversationAction.update) return false
    const channel = conversation?.channel
    if (!channel || channel.channelType !== ChannelTypeCommunityTopic) return false
    if (!channel.channelID || requestedThreadIds.has(channel.channelID)) return false

    const threadKey = `${ChannelTypeCommunityTopic}::${channel.channelID}`
    if (followedKeys.has(threadKey)) return false

    const parentGroupNo = conversation?.channelInfo?.orgData?.parentGroupNo
        || parseThreadChannelId(channel.channelID)?.groupNo
    return !!parentGroupNo && followedGroupNos.has(parentGroupNo)
}

/**
 * 拉取关注 tab 的 sidebar items，并按 category_id 分桶。
 *
 * 设计取舍：
 * - 第一版采用全量同步（version=0, last_msg_seqs=""），跑通后再接 IM SDK 游标做增量。
 * - dmsByCategory / threadsByCategory 是派生 state，由 items 推导出来；外部消费者按 category_id
 *   在内部查找对应的 conversation。
 */
export function useFollowSidebar(): UseFollowSidebarResult {
    const [items, setItems] = useState<SidebarItem[]>([])
    const [followVersion, setFollowVersion] = useState<number>(0)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const spaceId = WKApp.shared.currentSpaceId

    // 与 followVersion state 同步的 ref：消费者通过 ref 读到的永远是最新值，
    // 不受 React 渲染节奏 / useCallback 闭包过期影响。
    const versionRef = useRef<number>(0)
    const followedKeysRef = useRef<Set<string>>(new Set())
    const followedGroupNosRef = useRef<Set<string>>(new Set())
    const requestedThreadReloadsRef = useRef<Set<string>>(new Set())
    const threadReloadTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

    const load = useCallback(async (options: LoadOptions = {}) => {
        if (!spaceId) return
        const silent = options.silent === true
        if (!silent) {
            setIsLoading(true)
            setError(null)
        }
        try {
            const resp = await SidebarService.sync({
                tab: "follow",
                device_uuid: WKApp.shared.deviceId,
            })
            setItems(resp.items || [])
            const v = resp.follow_version ?? 0
            setFollowVersion(v)
            versionRef.current = v
        } catch (e: any) {
            if (!silent) {
                setError(e?.message || t("base.followSidebar.loadFailed"))
            }
        } finally {
            if (!silent) {
                setIsLoading(false)
            }
        }
    }, [spaceId])

    useEffect(() => {
        load()
    }, [load])

    // 外部触发重载（如 ThreadPanel 关注子区后）
    useEffect(() => {
        const handler = () => load()
        WKApp.mittBus.on("sidebar-reload" as any, handler)
        return () => { WKApp.mittBus.off("sidebar-reload" as any, handler) }
    }, [load])

    useEffect(() => {
        requestedThreadReloadsRef.current.clear()
        for (const timer of threadReloadTimersRef.current) {
            clearTimeout(timer)
        }
        threadReloadTimersRef.current.clear()
    }, [spaceId])

    const scheduleThreadReload = useCallback((threadChannelId?: string | null) => {
        if (!threadChannelId) return

        const threadKey = `${ChannelTypeCommunityTopic}::${threadChannelId}`
        if (followedKeysRef.current.has(threadKey)) return
        if (requestedThreadReloadsRef.current.has(threadChannelId)) return

        requestedThreadReloadsRef.current.add(threadChannelId)
        THREAD_SIDEBAR_RELOAD_DELAYS_MS.forEach((delay, index) => {
            const timer = setTimeout(() => {
                threadReloadTimersRef.current.delete(timer)
                if (followedKeysRef.current.has(threadKey)) {
                    requestedThreadReloadsRef.current.delete(threadChannelId)
                    return
                }

                void load({ silent: true }).finally(() => {
                    if (index === THREAD_SIDEBAR_RELOAD_DELAYS_MS.length - 1) {
                        requestedThreadReloadsRef.current.delete(threadChannelId)
                    }
                })
            }, delay)
            threadReloadTimersRef.current.add(timer)
        })
    }, [load])

    useEffect(() => {
        const conversationManager = WKSDK.shared().conversationManager
        if (!conversationManager?.addConversationListener) return

        const listener: ConversationListener = (conversation: Conversation, action: ConversationAction) => {
            if (!shouldReloadFollowSidebarForThreadConversation({
                conversation,
                action,
                followedKeys: followedKeysRef.current,
                followedGroupNos: followedGroupNosRef.current,
                requestedThreadIds: requestedThreadReloadsRef.current,
            })) {
                return
            }

            scheduleThreadReload(conversation.channel.channelID)
        }

        conversationManager.addConversationListener(listener)
        return () => {
            conversationManager.removeConversationListener?.(listener)
            for (const timer of threadReloadTimersRef.current) {
                clearTimeout(timer)
            }
            threadReloadTimersRef.current.clear()
        }
    }, [scheduleThreadReload])

    useEffect(() => {
        const listener = (event: {
            groupNo: string
            threadChannelId: string
            shortId?: string
            thread?: { channel_id?: string }
        }) => {
            if (!event?.groupNo) return

            const threadChannelId = event.threadChannelId
                || event.thread?.channel_id
                || (event.shortId ? buildThreadChannelId(event.groupNo, event.shortId) : undefined)
            scheduleThreadReload(threadChannelId)
        }

        WKApp.mittBus.on("wk:thread-created", listener)
        return () => {
            WKApp.mittBus.off("wk:thread-created", listener)
            for (const timer of threadReloadTimersRef.current) {
                clearTimeout(timer)
            }
            threadReloadTimersRef.current.clear()
        }
    }, [scheduleThreadReload])
    // sort 成功后调，乐观自增 ref，避免连续拖拽用旧版本号触发 CAS conflict
    const bumpVersion = useCallback(() => {
        versionRef.current = versionRef.current + 1
    }, [])

    // drop 那一刻立刻按新顺序物理重排 items 数组（同时同步 follow_sort 字段）。
    // 现在前端不再二次排序，渲染顺序 = items 数组顺序 → 必须物理移动才能让新顺序立即可见。
    // 其它分类的项保持原位不动。
    const applyOptimisticSort = useCallback(
        (sortItems: { target_type: number; target_id: string }[]) => {
            const sortedKeys = new Set(
                sortItems.map(si => `${si.target_type}::${si.target_id}`)
            )
            setItems(prev => {
                const next = prev.slice()
                // 收集受影响 items 在 prev 中的下标，按出现顺序排
                const affectedPositions: number[] = []
                prev.forEach((it, idx) => {
                    const key = `${it.target_type}::${it.target_id}`
                    if (sortedKeys.has(key)) affectedPositions.push(idx)
                })
                // 把 sortItems 按其新顺序填回这些位置上
                sortItems.forEach((si, i) => {
                    const pos = affectedPositions[i]
                    if (pos == null) return
                    const item = prev.find(it =>
                        `${it.target_type}::${it.target_id}` === `${si.target_type}::${si.target_id}`
                    )
                    if (item) next[pos] = { ...item, follow_sort: i + 1 }
                })
                return next
            })
        },
        []
    )

    const dmsByCategory = new Map<string, SidebarItem[]>()
    const threadsByCategory = new Map<string, SidebarItem[]>()
    const itemsByCategory = new Map<string, SidebarItem[]>()
    const followedGroupNos = new Set<string>()
    const followedKeys = new Set<string>()
    for (const it of items) {
        const key = it.category_id ?? NULL_CATEGORY
        const all = itemsByCategory.get(key) || []
        all.push(it)
        itemsByCategory.set(key, all)
        followedKeys.add(`${it.target_type}::${it.target_id}`)
        if (it.target_type === 1) {
            const list = dmsByCategory.get(key) || []
            list.push(it)
            dmsByCategory.set(key, list)
        } else if (it.target_type === 5) {
            const list = threadsByCategory.get(key) || []
            list.push(it)
            threadsByCategory.set(key, list)
        } else if (it.target_type === 2) {
            followedGroupNos.add(it.target_id)
        }
    }
    followedKeysRef.current = followedKeys
    followedGroupNosRef.current = followedGroupNos
    // 每个 category 内按 follow_sort ASC 排，覆盖 sidebar 响应里的 pinned DESC 拆段。
    // PM #337 spec 是用户主导的统一排序，pinned 只是标记不影响位置 —— 后端响应仍按
    // (pinned DESC, follow_sort ASC) 多键排，前端这里按 follow_sort 一锤定音。
    // 没 follow_sort 的项（罕见：刚加入还没 sort 过）排到最后。
    for (const list of itemsByCategory.values()) {
        list.sort((a, b) => {
            const sa = a.follow_sort ?? Number.MAX_SAFE_INTEGER
            const sb = b.follow_sort ?? Number.MAX_SAFE_INTEGER
            return sa - sb
        })
    }

    return {
        items,
        dmsByCategory,
        threadsByCategory,
        itemsByCategory,
        followedGroupNos,
        followedKeys,
        followVersion,
        versionRef,
        bumpVersion,
        applyOptimisticSort,
        isLoading,
        error,
        reload: load,
    }
}

/**
 * 单一数据源：Provider 在父层调用一次 useFollowSidebar()，子组件通过
 * useFollowSidebarContext() 共享。修复双实例导致的：
 *   (a) /sidebar/sync 重复请求；
 *   (b) follow 写操作只刷一份 hook，另一份保持 stale（badge / 列表 不一致）。
 */
const FollowSidebarContext = createContext<UseFollowSidebarResult | null>(null)

export const FollowSidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const value = useFollowSidebar()
    return React.createElement(FollowSidebarContext.Provider, { value }, children)
}

export function useFollowSidebarContext(): UseFollowSidebarResult {
    const ctx = useContext(FollowSidebarContext)
    if (!ctx) {
        throw new Error("useFollowSidebarContext must be used inside <FollowSidebarProvider>")
    }
    return ctx
}
