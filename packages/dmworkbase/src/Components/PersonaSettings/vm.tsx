import WKApp from "../../App"
import { ProviderListener } from "../../Service/Provider"
import { Toast } from "@douyinfe/semi-ui"
import { extractErrorMsg } from "../../Service/APIClient"

/**
 * PersonaSettings — AI 分身（On-Behalf-Of / OBO）页面 ViewModel
 *
 * 配套 RFC: ~/.openclaw/workspace/drafts/persona-clone-rfc.md §7 前端
 * 配套 GitHub Issue: Mininglamp-OSS/octo-web#46
 *
 * PR-C 阶段只做前端 UI / API 接线，绝不实现 fan-out / sendMessage on_behalf_of 改造
 * 等后端协议（PR-A）。在 PR-A merge 之前，本页所有 /v1/obo/* 请求都会 404 ——
 * VM 必须做到 404 / 网络错误时降级为空态而不是 Toast 红色喷射（详见
 * loadGrants 的注释）。
 *
 * API 合约（详见 RFC §5）：
 *   POST   /v1/obo/grants          → 创建 (grantor 自己调，需要 user token)
 *   GET    /v1/obo/grants          → 列出当前用户的所有 grant
 *   PUT    /v1/obo/grants/:id      → 更新（toggle global_enabled / mode）
 *   DELETE /v1/obo/grants/:id      → 撤销（软删除）
 *   GET    /v1/obo/grants/:id/scopes → 列出某 grant 下的所有 scope
 *   POST   /v1/obo/scopes          → 添加 per-channel scope
 *   DELETE /v1/obo/scopes/:id      → 移除 scope
 */

/**
 * Grant 主实体（grantor_uid 是当前用户自己；grantee_bot_uid 是代理 bot）。
 * mode === "auto" 是 v0 唯一支持的模式，"draft" 字段保留供 v1 草稿审批用。
 */
export interface OboGrant {
    id: number
    grantor_uid: string
    grantee_bot_uid: string
    grantee_bot_name?: string
    mode: "auto" | "draft"
    global_enabled: boolean
    active: boolean
    created_at?: number
    updated_at?: number
}

/**
 * Scope 实体 — per-channel 白名单。
 * channel_type 与 wukongimjssdk Channel 类型保持一致 (1=Person/DM, 2=Group)。
 */
export interface OboScope {
    id: number
    grant_id: number
    channel_id: string
    channel_type: number
    enabled: boolean
}

/**
 * MyBot — 用于「新建分身」时选择关联 bot 的下拉数据源。
 * 复用 /robot/my_bots（同 BotStore 页面）。
 */
export interface MyBot {
    uid: string
    name: string
    description?: string
}

/**
 * 顶层 PersonaSettings 列表页 ViewModel。
 *
 * 状态机：
 *   - `loading=true` 时显示 spinner
 *   - `loadError=true` 时显示「加载失败」+ 重试按钮（包含后端 404 的兼容态）
 *   - 否则显示 grants 列表 + 「新建分身」按钮
 *
 * 设计取舍：本 VM 不缓存 grants 到 WKApp / loginInfo —— 每次进入页面都重新拉。
 * 列表小（v0 单人通常 0~3 条），不需要 cache，简化 invalidation 心智。
 */
export class PersonaSettingsVM extends ProviderListener {
    grants: OboGrant[] = []
    loading: boolean = false
    /**
     * 加载是否失败。后端 404（PR-A 未 merge）也会进入这个状态。
     * 通过 isBackendMissing 区分「真错误」和「后端还没上」两种文案。
     */
    loadError: boolean = false
    /**
     * 标记 loadError 是否由后端 404 导致 —— 用于展示「功能即将上线」而非「加载失败」。
     */
    isBackendMissing: boolean = false

    /** 可被关联的 bot 列表（用于 PersonaCreate 下拉，懒加载） */
    myBots: MyBot[] = []
    myBotsLoading: boolean = false

    didMount(): void {
        void this.loadGrants()
    }

    /**
     * 拉取当前用户的所有 OBO grants。
     *
     * 容错合约（必须遵守）：
     *   - 404 → 不弹 Toast，标记 isBackendMissing=true，UI 显示「功能即将上线」
     *   - 其他错误 → 不弹 Toast，标记 loadError=true，UI 显示「加载失败 + 重试」
     *   - 之所以不 Toast：本页是「设置入口」，用户进来就想看列表，弹 Toast 会与
     *     页面内空态文案叠加，体验冗余。
     */
    async loadGrants(): Promise<void> {
        this.loading = true
        this.loadError = false
        this.isBackendMissing = false
        this.notifyListener()
        try {
            const res = await WKApp.apiClient.get<OboGrant[]>(`/v1/obo/grants`)
            this.grants = Array.isArray(res) ? res : []
        } catch (e: any) {
            this.grants = []
            if (e && typeof e === "object" && "status" in e && (e as any).status === 404) {
                this.isBackendMissing = true
            } else {
                this.loadError = true
            }
        } finally {
            this.loading = false
            this.notifyListener()
        }
    }

    /**
     * 加载可关联的 bot 列表（从 /robot/my_bots 拉，过滤掉已被关联的）。
     * 该接口在 BotStore 页面已经在用，PR-A 之前就可用，不存在 404 问题。
     */
    async loadMyBots(): Promise<void> {
        this.myBotsLoading = true
        this.notifyListener()
        try {
            const spaceId = WKApp.shared.currentSpaceId
            const res = await WKApp.apiClient.get<any[]>(
                "/robot/my_bots",
                spaceId ? { param: { space_id: spaceId } } : undefined,
            )
            const list: MyBot[] = Array.isArray(res)
                ? res.map((b) => ({ uid: b.uid, name: b.name || b.uid, description: b.description }))
                : []
            const grantedUids = new Set(this.grants.map((g) => g.grantee_bot_uid))
            this.myBots = list.filter((b) => !grantedUids.has(b.uid))
        } catch (e) {
            this.myBots = []
        } finally {
            this.myBotsLoading = false
            this.notifyListener()
        }
    }

    /**
     * 创建一个新的 grant（默认 mode=auto, global_enabled=false）。
     * 创建后 caller 应：reload list → push 进 PersonaEdit 让用户继续配 scope。
     */
    async createGrant(granteeBotUid: string): Promise<OboGrant | undefined> {
        try {
            const res = await WKApp.apiClient.post(`/v1/obo/grants`, {
                grantee_bot_uid: granteeBotUid,
                mode: "auto",
                global_enabled: false,
            })
            await this.loadGrants()
            return res as OboGrant
        } catch (e) {
            const msg = extractErrorMsg(e) || "创建分身失败"
            Toast.error(msg)
            return undefined
        }
    }

    /** 撤销（软删除）一个 grant。删除成功后 UI 应自行 pop / reload。 */
    async deleteGrant(id: number): Promise<boolean> {
        try {
            await WKApp.apiClient.delete(`/v1/obo/grants/${id}`)
            await this.loadGrants()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "撤销分身失败")
            return false
        }
    }

    /** 切换 global_enabled 或 mode；服务端用 PATCH-like 语义合并。 */
    async updateGrant(id: number, patch: Partial<Pick<OboGrant, "global_enabled" | "mode">>): Promise<boolean> {
        try {
            await WKApp.apiClient.put(`/v1/obo/grants/${id}`, patch)
            await this.loadGrants()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "更新失败")
            return false
        }
    }
}

/**
 * PersonaEdit 子页面 VM —— 单 grant 的 scope 编辑。
 *
 * 单独抽出一个 VM 避免顶层 PersonaSettingsVM 持有 per-grant 状态（避免 deep state，
 * 离开 edit 子页时自然 GC）。scopes 的写操作通过 WKApp.apiClient 直接调，
 * 不做本地乐观更新（v0 接口慢但请求量小，简单可靠 > 体感丝滑）。
 */
export class PersonaEditVM extends ProviderListener {
    grant: OboGrant
    scopes: OboScope[] = []
    loading: boolean = false
    loadError: boolean = false
    isBackendMissing: boolean = false

    constructor(grant: OboGrant) {
        super()
        this.grant = grant
    }

    didMount(): void {
        void this.loadScopes()
    }

    async loadScopes(): Promise<void> {
        this.loading = true
        this.loadError = false
        this.isBackendMissing = false
        this.notifyListener()
        try {
            const res = await WKApp.apiClient.get<OboScope[]>(`/v1/obo/grants/${this.grant.id}/scopes`)
            this.scopes = Array.isArray(res) ? res : []
        } catch (e: any) {
            this.scopes = []
            if (e && typeof e === "object" && "status" in e && (e as any).status === 404) {
                this.isBackendMissing = true
            } else {
                this.loadError = true
            }
        } finally {
            this.loading = false
            this.notifyListener()
        }
    }

    async addScope(channelId: string, channelType: number): Promise<boolean> {
        try {
            await WKApp.apiClient.post(`/v1/obo/scopes`, {
                grant_id: this.grant.id,
                channel_id: channelId,
                channel_type: channelType,
                enabled: true,
            })
            await this.loadScopes()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "添加会话失败")
            return false
        }
    }

    async removeScope(id: number): Promise<boolean> {
        try {
            await WKApp.apiClient.delete(`/v1/obo/scopes/${id}`)
            await this.loadScopes()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "移除会话失败")
            return false
        }
    }

    async toggleGlobal(enabled: boolean): Promise<boolean> {
        try {
            await WKApp.apiClient.put(`/v1/obo/grants/${this.grant.id}`, { global_enabled: enabled })
            this.grant = { ...this.grant, global_enabled: enabled }
            this.notifyListener()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "切换失败")
            return false
        }
    }

    async deleteGrant(): Promise<boolean> {
        try {
            await WKApp.apiClient.delete(`/v1/obo/grants/${this.grant.id}`)
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "撤销分身失败")
            return false
        }
    }
}

/**
 * 模块级 cache：当前用户是否有任何 active grant。
 * ChannelSetting 的「🤖 分身在此会话代答」toggle 是否渲染依赖这个值。
 * sections() 是 sync 函数无法 await，因此我们用 prefetched 缓存 + 后台刷新。
 *
 * 设计取舍（详见 ChannelSetting/vm.ts 的注释）：
 *   - 首次访问 ChannelSetting 时启动后台 prefetch；返回 false 不渲染 toggle
 *   - prefetch 完成后 notifyListener 让 ChannelSettingVM 重新 sections()
 *   - 切换用户（loginInfo.uid 变化）时 clearPersonaActiveCache() 必须被调用
 *     —— v0 由调用方在 logout 时清理；ChannelSetting/vm.ts 也会在 didMount 时
 *     prefetch refresh，所以即使没清理也只是次轮过期。
 *
 * 多账号防泄漏（YUJ-1178 review nit）：cache 与 in-flight promise 都按 grantor uid
 * 分桶，避免 SPA 内切换账号时把旧用户的结果返给新用户。当前 SPA logout 会 reload，
 * 严格说不会触发；但 cache key 的成本几乎为零，作为防御性实现保留。匿名（uid 为空）
 * 场景下统一用 "" 作为 key，行为与之前的模块单例一致。
 *
 * 语义说明（P1-2 修正，2026-05-19）：cache 的含义是「用户当前是否拥有任意 active
 * grant」，不再耦合 global_enabled。global on/off 与 per-channel scope 的覆盖关系
 * 属于 toggle 行为层（toggleOboScope），不应该作为渲染门把整个 toggle 隐藏。否则
 * 新建分身默认 global_enabled=false 的用户进任何会话都看不到 toggle，与「用 per-
 * channel scope 精确打开少数会话」的产品意图刚好相反。
 */
const hasActiveGrantCacheByUid: Map<string, boolean> = new Map()
const hasActiveGrantPromiseByUid: Map<string, Promise<boolean>> = new Map()

/** 当前 grantor uid。WKApp.loginInfo 在测试环境下可能未挂载，使用 try/catch 兜底。 */
function currentGrantorUid(): string {
    try {
        return (WKApp as any)?.loginInfo?.uid || ""
    } catch {
        return ""
    }
}

export function hasAnyActiveGrant(): boolean | undefined {
    return hasActiveGrantCacheByUid.get(currentGrantorUid())
}

/**
 * 异步刷新 active grant 缓存。返回 Promise<boolean>。
 * 同时进行的请求会被合流（共享同一个 in-flight promise）。
 * 失败时（包括后端 404）静默把缓存设为 false —— ChannelSetting toggle 不可见 ===
 * 用户没分身，行为安全。
 *
 * 错误清理（YUJ-1178 review nit）：finally 块保证 in-flight promise slot 被释放，
 * 即便 cache 写入抛错也不会让后续调用永远拿到老 promise。
 */
export function refreshActiveGrantCache(): Promise<boolean> {
    const uid = currentGrantorUid()
    const inFlight = hasActiveGrantPromiseByUid.get(uid)
    if (inFlight) return inFlight
    const p: Promise<boolean> = (async () => {
        try {
            const res = await WKApp.apiClient.get<OboGrant[]>(`/v1/obo/grants`)
            const list = Array.isArray(res) ? res : []
            // P1-2: 仅看 active，不再耦合 global_enabled，否则纯 per-channel scope
            // 模式下 toggle 永远不显示。
            const v = list.some((g) => g.active)
            hasActiveGrantCacheByUid.set(uid, v)
            return v
        } catch {
            hasActiveGrantCacheByUid.set(uid, false)
            return false
        } finally {
            // 关键：不论 try / catch 走哪个分支，都必须清掉 in-flight slot，
            // 否则后续调用会拿到一个已经 settle 的 promise（虽然行为正确，但语义混乱）。
            hasActiveGrantPromiseByUid.delete(uid)
        }
    })()
    hasActiveGrantPromiseByUid.set(uid, p)
    return p
}

/** 退出登录 / 切换账号时清缓存，避免别人看到旧用户的 toggle 状态。 */
export function clearPersonaActiveCache(): void {
    hasActiveGrantCacheByUid.clear()
    hasActiveGrantPromiseByUid.clear()
}

/**
 * 用于测试覆盖：直接读 / 写缓存值。生产代码请勿调用 set。
 */
export const __testing = {
    setCache(v: boolean | undefined): void {
        const uid = currentGrantorUid()
        if (v === undefined) {
            hasActiveGrantCacheByUid.delete(uid)
        } else {
            hasActiveGrantCacheByUid.set(uid, v)
        }
    },
    getCache(): boolean | undefined {
        return hasActiveGrantCacheByUid.get(currentGrantorUid())
    },
    /** 强制以指定 uid 写入 cache（多账号测试用）。 */
    setCacheForUid(uid: string, v: boolean | undefined): void {
        if (v === undefined) {
            hasActiveGrantCacheByUid.delete(uid)
        } else {
            hasActiveGrantCacheByUid.set(uid, v)
        }
    },
    getCacheForUid(uid: string): boolean | undefined {
        return hasActiveGrantCacheByUid.get(uid)
    },
    /** 暴露 in-flight promise map size 用于断言泄漏。 */
    inFlightCount(): number {
        return hasActiveGrantPromiseByUid.size
    },
}
