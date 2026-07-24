import { ProviderListener } from "../../Service/Provider"
import { extractErrorMsg } from "../../Service/APIClient"
import BotManageService, {
    type BotGroupsListResponse,
    type BotGroupItem,
} from "../../Service/BotManageService"

/**
 * BotManage — 独立「Bot 管理」模块 ViewModel（octo-web#235 / YUJ-2838）。
 *
 * 配套后端：octo-server#237 (YUJ-2836) 的群级免@偏好端点：
 *   GET    /v1/robot/:robot_id/groups?limit=&cursor=&q=        列群 + no_mention
 *   PUT    /v1/robot/:robot_id/groups/:group_no/mention_pref   UPSERT {no_mention:0|1}
 *   DELETE /v1/robot/:robot_id/groups/:group_no/mention_pref   删记录回退默认（幂等）
 *
 * 本期只实现 L3「💬 免@回答」群列表（MentionFreeList）。VM 命名 MentionFreeVM。
 *
 * 容错合约（与 PersonaSettings 同款）：
 *   - 404（后端 #237 未 merge）→ 不弹 Toast，标记 isBackendMissing=true，UI 显示
 *     「功能即将上线」。前端可先于后端上线搭 UI 骨架。
 *   - 其他错误 → loadError=true，UI 显示「加载失败 + 重试」，同样不 Toast。
 *
 * 防串台（issue「注意 2」）：L3 拉群 + 写入都复用 requestedUid / isStale 守卫
 * （仿 BotDetailModal:115-135,169）。当用户快速切换 bot 时，VM 的 robotId 会被
 * 上层 setRobotId 更新；任何在飞的旧 robotId 请求回来后通过 isStale() 比对当前
 * robotId 丢弃，绝不把上一个 bot 的群灌进当前 bot 的列表。
 */

export type { BotGroupItem } from "../../Service/BotManageService"

/** 单页拉取条数。与后端 groupsListDefaultLimit 对齐。 */
const GROUPS_PAGE_LIMIT = 30

/** 搜索输入防抖：避免逐字符打后端。UX 首选 250ms。 */
const SEARCH_DEBOUNCE_MS = 250

/**
 * MentionFreeVM —— L3「免@回答」群列表 ViewModel。
 *
 * 状态机：
 *   - loading=true（首屏）→ spinner
 *   - loadError=true → 「加载失败」+ 重试
 *   - isBackendMissing=true → 「功能即将上线」
 *   - 否则渲染列表（分区：已开启免@置顶 + 其他群）+ 触底 loadMore
 *
 * 搜索走后端 q 参数（g.name LIKE %q%）：命中该 bot 的全部管理群，不受当前已滚动
 * 加载到哪一页影响。输入经 debounce 后以 cursor=null 重新拉首屏；loadMore 沿用同一
 * 关键字翻页。搜索期间用 searching 标志（而非 loading）避免全屏 spinner 盖住输入框。
 */
export class MentionFreeVM extends ProviderListener {
    /** 当前管理的 bot uid（= robot_id）。可被上层 setRobotId 更新以支持复用实例。 */
    robotId: string

    groups: BotGroupItem[] = []
    loading: boolean = false
    loadingMore: boolean = false
    /**
     * 搜索/切关键字触发的重拉进行中标志（区别于首屏 loading）。
     * UI 用它显示轻量顶部条 spinner，不清空已有列表、不盖住搜索输入框——否则
     * 用户每敲一个字符整个列表都闪成全屏 spinner，无法连续输入。
     */
    searching: boolean = false
    loadError: boolean = false
    isBackendMissing: boolean = false
    toggleFailed: boolean = false
    toggleErrorMessage: string = ""

    /** 下一页游标（不透明 base64）。null/空 表示没有下一页。 */
    nextCursor: string | null = null
    hasMore: boolean = false

    /** 客户端搜索关键字（回显输入框，实际过滤走后端 q 参数）。 */
    searchKeyword: string = ""

    /** 已发到后端并生效的关键字（loadMore 翻页沿用同一 q）。 */
    private activeQuery: string = ""
    /** searchKeyword debounce 定时器句柄（浏览器 setTimeout 返回 number）。 */
    private searchDebounceHandle: ReturnType<typeof setTimeout> | null = null

    /**
     * 单调递增的请求世代号（防串台核心，codex review P1）。
     *
     * 为什么不能只比 robotId：A→B→A 的 ABA 序列里，第一次 A 的请求回来时 robotId
     * 又变回了 A，只比 robotId 会误判为「未过期」，把陈旧的第一帧 A 结果盖在新的
     * 第二帧 A 之上。改用 generation：每次 setRobotId / loadGroups 自增，请求捕获
     * 发起时的 gen，await 回来后比对 `gen !== this.generation` 即过期 —— 任何中途
     * 的切换（含 A→B→A）都会让旧 gen 落后，彻底消除 ABA。
     */
    private generation: number = 0

    constructor(robotId: string) {
        super()
        this.robotId = robotId
    }

    didMount(): void {
        void this.loadGroups()
    }

    /**
     * 切换到另一个 bot。重置全部分页/列表状态并重新拉首屏。
     *
     * 防串台关键路径：自增 generation 让任何在飞的 loadGroups/loadMore/toggle 回来
     * 后都判定为过期丢弃；同时显式复位 loadingMore（codex review P1）——否则旧 bot
     * 的 loadMore 在飞时切 bot，其 finally 因过期跳过清理，loadingMore 永远卡 true，
     * 新 bot 的分页被 loadMore 头部的 `if (this.loadingMore) return` 永久挡死。
     */
    setRobotId(robotId: string): void {
        if (this.robotId === robotId) return
        this.robotId = robotId
        this.generation++
        this.clearSearchDebounce()
        this.activeQuery = ""
        this.groups = []
        this.nextCursor = null
        this.hasMore = false
        this.searchKeyword = ""
        this.loading = false
        this.loadingMore = false
        this.searching = false
        this.loadError = false
        this.isBackendMissing = false
        this.toggleFailed = false
        this.toggleErrorMessage = ""
        void this.loadGroups()
    }

    setSearchKeyword(kw: string): void {
        this.searchKeyword = kw
        this.notifyListener() // 立刻回显输入框
        this.clearSearchDebounce()
        // debounce：输入稳定 SEARCH_DEBOUNCE_MS 后才以 cursor=null 重拉首屏，
        // 关键字空/仅空白则回到无 q 的全量首屏。
        this.searchDebounceHandle = setTimeout(() => {
            this.searchDebounceHandle = null
            void this.loadGroups({ search: true })
        }, SEARCH_DEBOUNCE_MS)
    }

    /** 清掉在飞的搜索 debounce 定时器（切 bot / 重新输入 / 组件卸载时调用）。 */
    private clearSearchDebounce(): void {
        if (this.searchDebounceHandle !== null) {
            clearTimeout(this.searchDebounceHandle)
            this.searchDebounceHandle = null
        }
    }

    /** 组件卸载时调用：清 debounce，避免定时器在实例销毁后回调泄漏。 */
    dispose(): void {
        this.clearSearchDebounce()
    }

    /**
     * 分区后的可见列表：
     *   - 已开启免@（no_mention=true）置顶，其它群在后；
     *   - 分区内保持后端返回的相对顺序（gm.id 升序，稳定）。
     *
     * 关键字过滤已下沉到后端（q 参数），这里不再做本地 name 二次过滤——否则会
     * 对后端已过滤好的结果再过滤一遍，且在 debounce 未触发的中间态短暂闪空。
     */
    visibleGroups(): { enabled: BotGroupItem[]; others: BotGroupItem[] } {
        const enabled = this.groups.filter((g) => g.no_mention)
        const others = this.groups.filter((g) => !g.no_mention)
        return { enabled, others }
    }

    /**
     * 拉首屏群列表（cursor 从头）。
     *
     * @param opts.search 由 setSearchKeyword 的 debounce 触发时为 true：翻转 searching
     *   而非 loading，避免全屏 spinner 盖住输入框、清空已有列表。首屏 / 重试 / 切 bot
     *   走默认（loading）分支。
     *
     * 关键字：始终取当前 searchKeyword.trim() 作为后端 q，成功后记录到 activeQuery
     * 供 loadMore 翻页沿用。
     *
     * 防串台：捕获调用时的 generation，await 之后用 isStale() 比对，过期则整段丢弃
     * （仿 BotDetailModal.loadBotInfo:169，但用 gen 替代裸 uid 比较以防 ABA）。
     */
    async loadGroups(opts: { search?: boolean } = {}): Promise<void> {
        const requestedUid = this.robotId
        if (!requestedUid) return
        // 自增 gen 让此前在飞的 loadGroups/loadMore（同一 bot 的重复触发）也作废，
        // 避免重试 / 兜底首拉与首次 didMount 撞车后旧响应盖新响应。
        const gen = ++this.generation
        const isStale = () => this.generation !== gen
        const q = this.searchKeyword.trim()
        const isSearch = !!opts.search

        if (isSearch) {
            // 搜索：保留已有列表 + 输入框，只显示轻量进行中标志。
            this.searching = true
        } else {
            this.loading = true
        }
        this.loadingMore = false
        this.loadError = false
        this.isBackendMissing = false
        this.toggleFailed = false
        this.toggleErrorMessage = ""
        this.notifyListener()
        try {
            const res = await BotManageService.listGroups({
                robotId: requestedUid,
                limit: GROUPS_PAGE_LIMIT,
                q: q || undefined,
            })
            if (isStale()) return
            const { list, nextCursor, hasMore } = parseGroupsResp(res)
            this.groups = list
            this.nextCursor = nextCursor
            this.hasMore = hasMore
            // 成功后记录已生效关键字，供 loadMore 翻页沿用同一 q。
            this.activeQuery = q
        } catch (e: any) {
            if (isStale()) return
            this.groups = []
            this.nextCursor = null
            this.hasMore = false
            this.activeQuery = q
            if (e && typeof e === "object" && "status" in e && (e as any).status === 404) {
                this.isBackendMissing = true
            } else {
                this.loadError = true
            }
        } finally {
            if (!isStale()) {
                this.loading = false
                this.searching = false
                this.notifyListener()
            }
        }
    }

    /**
     * 触底懒加载下一页（cursor 分页）。已无下一页 / 正在加载 / 首屏加载中 → 跳过。
     *
     * 防串台：捕获发起时 generation，append 前用 isStale() 确认未切换/未重载，
     * 否则会把旧请求的下一页拼到新列表里。
     */
    async loadMore(): Promise<void> {
        if (this.loading || this.loadingMore || this.searching) return
        if (!this.hasMore || !this.nextCursor) return

        const requestedUid = this.robotId
        const requestedCursor = this.nextCursor
        if (!requestedUid) return
        const gen = this.generation
        const isStale = () => this.generation !== gen

        this.loadingMore = true
        this.notifyListener()
        try {
            const res = await BotManageService.listGroups({
                robotId: requestedUid,
                limit: GROUPS_PAGE_LIMIT,
                cursor: requestedCursor,
                // 翻页沿用首屏已生效的关键字，保证下一页与当前搜索结果同源。
                q: this.activeQuery || undefined,
            })
            if (isStale()) return
            const { list, nextCursor, hasMore } = parseGroupsResp(res)
            // 去重 append：极端并发下后端可能回放边界项，按 group_no 去重防重复 key。
            const seen = new Set(this.groups.map((g) => g.group_no))
            const appended = list.filter((g) => !seen.has(g.group_no))
            this.groups = [...this.groups, ...appended]
            this.nextCursor = nextCursor
            this.hasMore = hasMore
        } catch (e) {
            // 分页失败不弹 Toast 也不翻转 loadError（首屏已成功，列表仍可用）；
            // 保留 hasMore 让用户可再次触底重试。
            if (isStale()) return
            // eslint-disable-next-line no-console
            console.warn("[BotManage] loadMore failed", e)
        } finally {
            if (!isStale()) {
                this.loadingMore = false
                this.notifyListener()
            }
        }
    }

    /**
     * 切换某群的「免@回答」开关。仿 mute (module.tsx:1773-1783)：ctx.loading 占位 +
     * catch 回弹。
     *
     *   开（next=true）→ PUT  robot/uid/groups/g/mention_pref {no_mention:1}
     *   关（next=false）→ DELETE robot/uid/groups/g/mention_pref（删记录回退默认）
     *
     * 成功后局部更新 no_mention 并触发重排（visibleGroups 重新分区）；
     * 失败时记录错误信息 + 不改本地状态（开关回弹由 ListItemSwitch 的 checked 复位驱动）。
     *
     * 返回是否成功，供视图层复位 ctx.loading。
     *
     * 防串台：捕获发起时 generation，写入回来后 isStale() 比对，过期丢弃
     * （绝不把成功结果写进已切走 / 已重载的 bot 列表）。
     */
    async toggleMentionFree(groupNo: string, next: boolean): Promise<boolean> {
        const requestedUid = this.robotId
        if (!requestedUid) return false
        const gen = this.generation
        const isStale = () => this.generation !== gen
        this.toggleFailed = false
        this.toggleErrorMessage = ""
        try {
            if (next) {
                await BotManageService.enableMentionFree(requestedUid, groupNo)
            } else {
                await BotManageService.disableMentionFree(requestedUid, groupNo)
            }
            if (isStale()) return false
            // 局部更新 + 重排：只改命中项的 no_mention，visibleGroups 会重新分区置顶。
            this.groups = this.groups.map((g) =>
                g.group_no === groupNo ? { ...g, no_mention: next } : g,
            )
            this.notifyListener()
            return true
        } catch (e) {
            if (isStale()) return false
            this.toggleFailed = true
            this.toggleErrorMessage = extractErrorMsg(e) || ""
            return false
        }
    }
}

/**
 * 解析列群响应 envelope。后端返回 {list, next_cursor, has_more}；做防御性兜底：
 * 非数组 list → []，next_cursor 仅接受非空字符串，has_more 强制布尔。
 */
function parseGroupsResp(res: BotGroupsListResponse | undefined): {
    list: BotGroupItem[]
    nextCursor: string | null
    hasMore: boolean
} {
    const list = res && Array.isArray(res.list) ? res.list : []
    const rawCursor = res?.next_cursor
    const nextCursor =
        typeof rawCursor === "string" && rawCursor.length > 0 ? rawCursor : null
    const hasMore = !!res?.has_more && nextCursor !== null
    return { list, nextCursor, hasMore }
}
