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
 *
 * v2（octo-web#73 / octo-server#108）新增：
 *   - `persona_prompt`：用户自定义的回复风格 prompt（中文），由 grantor 在 Create/Edit
 *     表单里填写，POST/PUT 时携带；后端写入 grant 表 persona_prompt 字段，fan-out 时
 *     拼到 system prompt 里影响 bot 回答风格。
 *   - `active`：v1 已有字段，但在 v2 由「列表 toggle」直接驱动 —— 用户在 PersonaList
 *     点开关 → 后端 mutex 自动把其他 grant 的 active 置为 false（同一用户最多 1 个
 *     active grant 接管会话）。前端只需 PUT `{active: true|false}`，不必关心互斥逻辑。
 */
export interface OboGrant {
    id: number
    grantor_uid: string
    grantee_bot_uid: string
    grantee_bot_name?: string
    mode: "auto" | "draft"
    global_enabled: boolean
    active: boolean
    /**
     * v2：自定义回复风格 prompt。可空（旧 grant 未填写时为 undefined / 空串）。
     * 前端表单为可选填写，提交时若空则不放进 POST/PUT body（让后端保持 NULL/未改）。
     */
    persona_prompt?: string
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
 *
 * 数据来源（YUJ-1444, 2026-05-20 后）：
 *   - `/robot/my_bots`     —— 当前用户已加好友的 bot（含 botfather 撮合的 + 自动加好友的）
 *   - `/robot/space_bots`  —— 当前 space 的 bot（仅取 creator_uid===me 的「我创建的」）
 * 两端结果按 uid 合并去重，再剔除已经绑定 grant 的 uid。详见 loadMyBots()。
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

    /**
     * BUG-1 fix (YUJ-1341, 2026-05-19)：原实现在 VM 的 `didMount()` 里自动 `loadGrants()`，
     * 依赖 `Provider.componentDidMount → listener.didMount()` 这条隐式链路触发。E2E
     * 复现了 grant 已存在却渲染空态的 bug：在 React 18 + 父级 WKViewQueue 的环境下，
     * Provider 的 componentDidMount 时机与 React 子组件的 componentDidMount 之间有
     * 微妙的时序差异（子组件先 mount → 也尝试 loadGrants → 与 VM 的 didMount 撞车，
     * 后到的覆盖前到的 `vm.grants`）。
     *
     * 现在改成「单一触发源 = PersonaListBody.componentDidMount」，VM 不再在 didMount
     * 里自动启动加载。如果未来有别处用同一个 VM, 应当在挂载时显式调用 loadGrants()，
     * 与 PersonaCreate.loadMyBots 的用法对齐。
     *
     * 为避免历史调用（如重试按钮、createGrant 后 reload、PersonaEdit onChange 回调）
     * 与 mount 时的首次 load 撞车，我们在 loadGrants 内部加一个 in-flight 守卫：
     * 同时只允许一个请求在飞，重入调用直接复用同一个 Promise。详见 loadGrants 注释。
     */
    private loadGrantsInFlight: Promise<void> | undefined

    /**
     * 拉取当前用户的所有 OBO grants。
     *
     * 容错合约（必须遵守）：
     *   - 404 → 不弹 Toast，标记 isBackendMissing=true，UI 显示「功能即将上线」
     *   - 其他错误 → 不弹 Toast，标记 loadError=true，UI 显示「加载失败 + 重试」
     *   - 之所以不 Toast：本页是「设置入口」，用户进来就想看列表，弹 Toast 会与
     *     页面内空态文案叠加，体验冗余。
     *
     * In-flight 守卫 (BUG-1, YUJ-1341)：同一时刻只允许一个请求在飞，重入调用复用
     * 同一个 Promise。这是为了让「mount 时触发」与「createGrant/deleteGrant/retry
     * 等业务路径触发」之间不会撞车 —— 之前 race 时第二次的响应会覆盖第一次写入的
     * grants（mock 测试里第二次甚至拿到 undefined，把列表清空）。生产同样可能发生：
     * 服务端两次返回顺序不保证按调用顺序到达。
     */
    async loadGrants(): Promise<void> {
        if (this.loadGrantsInFlight) return this.loadGrantsInFlight
        this.loadGrantsInFlight = (async () => {
            this.loading = true
            this.loadError = false
            this.isBackendMissing = false
            this.notifyListener()
            try {
                const res = await WKApp.apiClient.get<any>(`obo/grants`)
                // API returns {items: [...]} envelope; unwrap it.
                const arr = Array.isArray(res) ? res : (res && Array.isArray(res.items) ? res.items : [])
                this.grants = arr as OboGrant[]
            } catch (e: any) {
                this.grants = []
                if (e && typeof e === "object" && "status" in e && (e as any).status === 404) {
                    this.isBackendMissing = true
                } else {
                    this.loadError = true
                }
            } finally {
                this.loading = false
                this.loadGrantsInFlight = undefined
                this.notifyListener()
            }
        })()
        return this.loadGrantsInFlight
    }

    /**
     * 加载可关联的 bot 列表，过滤掉已被关联的。
     *
     * BUG-3 fix (YUJ-1444, 2026-05-20)：im-test 上用户报告「新建分身」picker 永远空。
     * 根因是 `/robot/my_bots` 只返回当前用户**已加好友**的 bot —— 用户在 BotStore /
     * 后台**创建**了 bot 但没把自己加为好友，这些 bot 不会出现在 `my_bots` 里。
     *
     * 修复：同时拉 `/robot/space_bots`（与 BotStore 页面同款），从中筛出
     * `creator_uid === currentUid` 的「我创建的」bot，再与 `my_bots` 合并去重。
     * 这覆盖了两个真实路径：
     *   (a) 用户创建 + 自动加好友 → 出现在 my_bots（旧路径不变）
     *   (b) 用户创建但未加好友（im-test 常见情况）→ 通过 space_bots + creator_uid
     *       兜底进入 picker
     *
     * 错误降级：任一端点失败都用空数组兜底；两端都失败时 myBots=[]，UI 仍正确显示
     * 「暂无可关联的 Bot」。不对单独失败弹 Toast —— 这是「设置子页」，picker 空时
     * 用户能从文案得知，比 Toast 干扰更小；同时打 console.warn 便于线上排查。
     */
    async loadMyBots(): Promise<void> {
        this.myBotsLoading = true
        this.notifyListener()
        try {
            const spaceId = WKApp.shared.currentSpaceId
            const myUid = ((WKApp as any)?.loginInfo?.uid) || ""

            // 并发拉两端，单端失败不影响另一端。
            const [myRes, spaceRes] = await Promise.all([
                WKApp.apiClient.get<any[]>(
                    "/robot/my_bots",
                    spaceId ? { param: { space_id: spaceId } } : undefined,
                ).catch((e) => {
                    // 静默失败：picker 不强依赖 my_bots，space_bots 仍可补足。
                    // eslint-disable-next-line no-console
                    console.warn("[PersonaSettings] /robot/my_bots failed", e)
                    return [] as any[]
                }),
                spaceId
                    ? WKApp.apiClient.get<any[]>(
                          "/robot/space_bots",
                          { param: { space_id: spaceId } },
                      ).catch((e) => {
                          // eslint-disable-next-line no-console
                          console.warn("[PersonaSettings] /robot/space_bots failed", e)
                          return [] as any[]
                      })
                    : Promise.resolve([] as any[]),
            ])

            const myBotsRaw: any[] = Array.isArray(myRes) ? myRes : []
            const spaceBotsRaw: any[] = Array.isArray(spaceRes) ? spaceRes : []

            // space_bots 包含整个 space 的 bot：只取「当前用户创建的」，避免把别人的
            // bot 列出来让用户误绑定。creator_uid 字段命名与 BotStore.BotInfo 一致。
            const ownedSpaceBots = myUid
                ? spaceBotsRaw.filter(
                      (b) => b && typeof b === "object" && (b as any).creator_uid === myUid,
                  )
                : []

            // 合并 + 去重（按 uid，先到先得；my_bots 优先因为已加好友的元数据更完整）。
            const merged = new Map<string, MyBot>()
            for (const b of [...myBotsRaw, ...ownedSpaceBots]) {
                if (!b || typeof b !== "object") continue
                const uid = (b as any).uid
                if (!uid || merged.has(uid)) continue
                merged.set(uid, {
                    uid,
                    name: (b as any).name || uid,
                    description: (b as any).description,
                })
            }

            const grantedUids = new Set(this.grants.map((g) => g.grantee_bot_uid))
            this.myBots = Array.from(merged.values()).filter((b) => !grantedUids.has(b.uid))
        } catch (e) {
            // 兜底：两端 catch 已经返回 []，这里只为捕获非预期同步异常。
            // eslint-disable-next-line no-console
            console.warn("[PersonaSettings] loadMyBots unexpected error", e)
            this.myBots = []
        } finally {
            this.myBotsLoading = false
            this.notifyListener()
        }
    }

    /**
     * 创建一个新的 grant（默认 mode=auto, global_enabled=false）。
     * 创建后 caller 应：reload list → push 进 PersonaEdit 让用户继续配 scope。
     *
     * v2 (octo-web#73)：第二参数 personaPrompt 允许在创建时直接带上用户填写的回复风格。
     * 留空（未传或空串）时不放进 POST body，等用户在 PersonaEdit 里再补，避免空串覆盖
     * 后端的 NULL 默认（fan-out 拼 system prompt 时会忽略 NULL 而处理空串）。
     *
     * Round-2 nit（YUJ-1193 / yujiawei R2）：成功后清空 `myBots` 缓存，
     * 让下一次 PersonaCreate mount 时 useEffect 的 `length === 0` 守卫真的触发
     * `loadMyBots()` 重拉 —— 否则用户「+ 新建分身」→ 选 bot → 创建 → pop →
     * 再「+ 新建分身」会看到刚绑过的 bot 还在 picker 里，导致 duplicate POST。
     */
    async createGrant(granteeBotUid: string, personaPrompt?: string): Promise<OboGrant | undefined> {
        try {
            // v2 (octo-web#73)：persona_prompt 可选；只有用户实际填写了非空内容时才放进 body，
            // 否则空串会让后端把 NULL 覆盖成 ''，影响 fan-out 的 system prompt 拼装逻辑。
            const body: Record<string, any> = {
                grantee_bot_uid: granteeBotUid,
                mode: "auto",
                global_enabled: false,
            }
            const trimmed = (personaPrompt || "").trim()
            if (trimmed) {
                body.persona_prompt = trimmed
            }
            const res = await WKApp.apiClient.post(`obo/grants`, body)
            await this.loadGrants()
            // 已绑定的 bot 必须从下一次 PersonaCreate 的 picker 中消失：
            // 清缓存让 useEffect 的 length===0 守卫重新触发 loadMyBots()。
            this.myBots = []
            this.notifyListener()
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
            await WKApp.apiClient.delete(`obo/grants/${id}`)
            await this.loadGrants()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "撤销分身失败")
            return false
        }
    }

    /**
     * 切换 global_enabled / mode / active / persona_prompt；服务端用 PATCH-like 语义合并。
     *
     * v2 (octo-web#73)：
     *   - `active` 字段由列表 toggle 直接驱动。后端在 PUT `{active: true}` 时自动把当前
     *     用户其它 grant 的 active 置为 false（mutex）——前端不需要预先调一遍 disable，
     *     成功后 `loadGrants()` 会拉回新状态，UI 自然更新。
     *   - `persona_prompt` 由 PersonaEdit 表单的「保存」按钮驱动，与 active 可以同一次
     *     PUT 提交，减少往返。
     */
    async updateGrant(
        id: number,
        patch: Partial<Pick<OboGrant, "global_enabled" | "mode" | "active" | "persona_prompt">>,
    ): Promise<boolean> {
        try {
            await WKApp.apiClient.put(`obo/grants/${id}`, patch)
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
            const res = await WKApp.apiClient.get<any>(`obo/grants/${this.grant.id}/scopes`)
            // API returns {items: [...]} envelope; unwrap it.
            const arr = Array.isArray(res) ? res : (res && Array.isArray(res.items) ? res.items : [])
            this.scopes = arr as OboScope[]
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
            await WKApp.apiClient.post(`obo/scopes`, {
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
            await WKApp.apiClient.delete(`obo/scopes/${id}`)
            await this.loadScopes()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "移除会话失败")
            return false
        }
    }

    async toggleGlobal(enabled: boolean): Promise<boolean> {
        try {
            await WKApp.apiClient.put(`obo/grants/${this.grant.id}`, { global_enabled: enabled ? 1 : 0 })
            this.grant = { ...this.grant, global_enabled: enabled }
            this.notifyListener()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "切换失败")
            return false
        }
    }

    /**
     * v2 (octo-web#73)：保存 PersonaEdit 表单 —— 一次 PUT 同时提交 persona_prompt + active。
     *
     * 入参语义：
     *   - personaPrompt：始终发送，允许空串覆盖（用户主动清空 prompt 是合法的「恢复到无风格」操作）。
     *     这与 createGrant 的「空串不放进 body」策略不同 —— 创建时空串意味着「我还没想好」，
     *     编辑时空串意味着「我明确要清掉之前写的」。
     *   - active：可选。提供时会让后端做 mutex（true 时把其它 grant active 置 false）。
     *
     * 成功后乐观更新本地 grant；caller 应额外调父级 onChange 让 PersonaSettingsVM.grants
     * 与服务端重新对齐（后端 mutex 改了别的 grant 我们这里看不见）。
     */
    async savePersonaForm(personaPrompt: string, active?: boolean): Promise<boolean> {
        try {
            const body: Record<string, any> = { persona_prompt: personaPrompt }
            if (typeof active === "boolean") {
                body.active = active
            }
            await WKApp.apiClient.put(`obo/grants/${this.grant.id}`, body)
            this.grant = {
                ...this.grant,
                persona_prompt: personaPrompt,
                ...(typeof active === "boolean" ? { active } : {}),
            }
            this.notifyListener()
            return true
        } catch (e) {
            Toast.error(extractErrorMsg(e) || "保存失败")
            return false
        }
    }

    async deleteGrant(): Promise<boolean> {
        try {
            await WKApp.apiClient.delete(`obo/grants/${this.grant.id}`)
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
            const res = await WKApp.apiClient.get<any>(`obo/grants`)
            // API returns {items: [...]} envelope; unwrap it.
            const raw = Array.isArray(res) ? res : (res && Array.isArray(res.items) ? res.items : [])
            const list: OboGrant[] = raw
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
