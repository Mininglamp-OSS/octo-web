import { ChannelInfoListener, SubscriberChangeListener } from "wukongimjssdk";
import { Channel, ChannelInfo, ChannelTypePerson, WKSDK, Subscriber } from "wukongimjssdk";
import { GroupRole, SubscriberStatus } from "../../Service/Const";
import RouteContext from "../../Service/Context";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import { ChannelSettingRouteData } from "./context";
import { Row, Section } from "../../Service/Section";
import { ListItemSwitch, ListItemSwitchContext } from "../ListItem";
import { Toast } from "@douyinfe/semi-ui";
import {
    OboGrant,
    OboScope,
    hasAnyActiveGrant,
    refreshActiveGrantCache,
} from "../PersonaSettings/vm";


export class ChannelSettingVM extends ProviderListener {
    channel!: Channel
    channelInfo?:ChannelInfo

    subscribers: Subscriber[] = []
    subscribersTop: Subscriber[] = [] // 显示的成员
    subscriberChangeListener?: SubscriberChangeListener
    channelInfoListener!:ChannelInfoListener
    subscriberOfMe?: Subscriber
    routeData:ChannelSettingRouteData = new ChannelSettingRouteData()

    private _finishButtonLoading?:boolean
    private _finishButtonDisable?:boolean

    /**
     * 当前 channel 上的 OBO scope（per-channel 白名单）。
     * undefined = 尚未拉取 / 没匹配到任何 active grant; null = 已拉取但当前 channel 不在 scope；
     * OboScope = 已加入 scope（可能 enabled=true 或 false）。
     *
     * 「未拉取」与「不在 scope」两种状态的区分由 `_oboScopeLoaded` 单独承载 ——
     * 不要再依赖 `_oboScope === undefined` 作为"未加载"信号，因为非 404 错误路径
     * 也会把 `_oboScope` 保持 undefined（不会被错误地降级成 null），需要 `_oboScopeLoaded`
     * 才能可靠地区分「请求失败、暂时不能交互」与「请求成功、scope 不存在」。
     */
    private _oboScope: OboScope | undefined | null = undefined
    /**
     * `refreshOboScope` 是否成功跑完一次（含「拿到 active grant 之后又成功拿到 scopes」
     * 的整条链路）。P1-3：只有 _oboScopeLoaded=true 且 _activeGrantId 已知时才渲染 toggle，
     * 避免把"请求失败"误显示成"可交互但点不动"的 dead toggle。
     */
    private _oboScopeLoaded = false
    /** 是否正在异步切换 scope（用于 toggle loading 状态）。 */
    private _oboScopeUpdating = false
    /** PR-A 未 merge 时，所有 /v1/obo/* 都 404；标记后整体跳过 toggle 渲染。 */
    private _oboBackendMissing = false
    /** 当前用户匹配本 channel 的第一个 active grant（v0 单用户最多 1 个，但保留扩展性）。 */
    private _activeGrantId?: number
    /**
     * 当前 active grant 的 global_enabled 标志。决定 toggle 在「无 per-channel scope」时
     * 的初始 checked 状态以及关闭操作的语义：
     *   - global=true + 无 scope → 实际生效中（checked=true），「关」需 POST enabled=false 作为排除。
     *   - global=true + scope.enabled=false → 排除已存在（checked=false），「开」需 DELETE scope（回退到 global=true 生效）。
     *   - global=false + 无 scope → 未启用（checked=false），「开」需 POST enabled=true。
     *   - global=false + scope.enabled=true → 单点启用（checked=true），「关」需 DELETE scope。
     *
     * Round-2 P1（YUJ-1193）：原实现只看 `_oboScope.enabled` 而忽略 global，导致全局开启的
     * 用户在每个 channel 里都看到 toggle=OFF（与实际行为相反），且 toggleOboScope(false) 在
     * 无 scope 时直接 no-op，用户无法表达「全局开启但排除此会话」的意图。
     */
    private _activeGrantGlobalEnabled = false

    /**
     * unmount 守卫：异步 refreshActiveGrantCache / refreshOboScope 可能在 VM 已经
     * 销毁后 resolve，再去 notifyListener 会向已经 unsubscribe 的 Provider 推更新。
     * 在 didUnMount 里置 true，所有异步分支都要先检查这个再写状态 / 触发回调。
     */
    private _disposed = false

    constructor(channel: Channel) {
        super()
        this.channel = channel
        this.routeData.channel = channel

    }

    get finishButtonLoading():boolean | undefined{
        return this._finishButtonLoading
    }

    set finishButtonDisable(v:boolean|undefined) {
        this._finishButtonDisable = v
        this.notifyListener()
    }
    get finishButtonDisable() {
        return this._finishButtonDisable
    }

    set finishButtonLoading(v:boolean|undefined) {
        this._finishButtonLoading = v
        this.notifyListener()
    }

    sections(context:RouteContext<ChannelSettingRouteData>) {
        const base = WKApp.shared.channelSettings(context)
        const personaSection = this.buildPersonaSection()
        if (personaSection) {
            base.push(personaSection)
        }
        return base
    }

    /**
     * 「🤖 分身在此会话代答」section 构造（PR-C / GH octo-web#46）。
     *
     * 仅在以下条件全部满足时渲染：
     *   1. 已知当前用户存在至少一个 active grant（hasAnyActiveGrant() === true）
     *   2. 后端 OBO endpoints 未返回 404（_oboBackendMissing === false）
     *   3. 已成功跑过一次 refreshOboScope（_oboScopeLoaded === true）
     *   4. 已经匹配到具体的 _activeGrantId（toggle 真的能点动）
     *
     * 条件不满足时返回 undefined（不在 UI 上占空 section title）。
     *
     * P1-3：原先只检查 `_oboScope === undefined`，结果非 404 错误把 _oboScope 改成 null
     * 之后被当成"加载成功 + scope=off"渲染出来，但 _activeGrantId 又是 undefined，
     * toggle 点了什么也不发生。现在用 _oboScopeLoaded 显式标记"那条链路成功跑完"，
     * 错误路径让 _oboScope 保持 undefined 即可。
     *
     * Section 单独成块（不并入「消息免打扰 / 聊天置顶」组），原因：
     *   - 视觉上需要 subtitle 解释「分身代答是什么」（详见 RFC §1）
     *   - 上下游 OBO 设置（PersonaEdit / 活动日志）会持续扩在这个组里
     */
    private buildPersonaSection(): Section | undefined {
        const hasGrant = hasAnyActiveGrant()
        if (hasGrant !== true) return undefined
        if (this._oboBackendMissing) return undefined
        if (!this._oboScopeLoaded) return undefined
        if (this._activeGrantId === undefined) return undefined

        // Round-2 P1（YUJ-1193）—— checked 必须同时考虑 grant.global_enabled：
        //   - 若 per-channel scope 记录存在 → scope.enabled 覆盖 global（per-channel 是 override 层）
        //   - 否则 → checked 跟随 global_enabled
        // 旧实现只看 _oboScope.enabled，会让 global=true / 无 scope 场景显示 OFF，与事实相反。
        const checked = this._oboScope
            ? this._oboScope.enabled
            : this._activeGrantGlobalEnabled
        return new Section({
            subtitle: "开启后，AI 分身会在此会话中以你的身份代答消息",
            rows: [
                new Row({
                    cell: ListItemSwitch,
                    properties: {
                        title: "🤖 分身在此会话代答",
                        checked,
                        onCheck: (v: boolean, ctx?: ListItemSwitchContext) => {
                            if (this._oboScopeUpdating) return
                            this._oboScopeUpdating = true
                            if (ctx) ctx.loading = true
                            void this.toggleOboScope(v).finally(() => {
                                if (this._disposed) return
                                this._oboScopeUpdating = false
                                if (ctx) ctx.loading = false
                                this.notifyListener()
                            })
                        },
                    },
                }),
            ],
        })
    }

    /**
     * 切换当前 channel 的 OBO scope。
     *
     * 完整状态机（Round-2 P1, YUJ-1193）：
     *   global=T, scope=null,           checked=T → click off → POST {enabled:false}（排除）
     *   global=T, scope={enabled:T},    checked=T → click off → DELETE scope（冗余记录回收，仍 OFF? 不，global=T 反而是 ON）
     *                                            实际上 global=T + scope=enabled=T 是冗余 ON 状态；click off 想要 OFF → DELETE 后效果仍是 global=T=ON，
     *                                            所以正确语义是 DELETE 旧 scope + POST {enabled:false}。
     *   global=T, scope={enabled:F},    checked=F → click on  → DELETE scope（回退到 global=T 即 ON）
     *   global=F, scope=null,           checked=F → click on  → POST {enabled:true}
     *   global=F, scope={enabled:T},    checked=T → click off → DELETE scope（global=F 即 OFF）
     *   global=F, scope={enabled:F},    checked=F → click on  → DELETE + POST {enabled:true}
     *
     * 简化原则：目标状态 effective === enable；如果删除当前 scope 后 global 即满足目标，则不再 POST；
     * 否则 POST 一条 enabled=enable 的新 scope。
     *
     * 错误处理：任何步骤失败都 Toast + refreshOboScope() 回滚到服务端真值。
     *
     * 注意（task §1 spec #5）：调用结束后强制 refreshOboScope() 拉一次，把可能被 PersonaEdit
     * 改过的 global_enabled 同步进来，避免 toggle 一直拿过期 _activeGrantGlobalEnabled。
     */
    private async toggleOboScope(enable: boolean): Promise<void> {
        if (this._activeGrantId === undefined) return
        try {
            if (this._oboScope) {
                // 已有 scope 记录：先 DELETE，再视情况决定是否 POST。
                await WKApp.apiClient.delete(`obo/scopes/${this._oboScope.id}`)
                if (this._disposed) return
                this._oboScope = null
                if (enable !== this._activeGrantGlobalEnabled) {
                    // global 不能直接表达 enable → 还需 POST 一条 override。
                    const created = await WKApp.apiClient.post(`obo/scopes`, {
                        grant_id: this._activeGrantId,
                        channel_id: this.channel.channelID,
                        channel_type: this.channel.channelType,
                        enabled: enable,
                    }) as OboScope
                    if (this._disposed) return
                    this._oboScope = created
                }
                // else: enable === global，删除 scope 之后 global 自动生效，无需 POST。
            } else {
                // 无 scope 记录：
                //   enable === global → 已经匹配（理论上 UI 不应允许点击；保险起见 no-op）。
                //   enable !== global → POST 一条 override（关闭=排除/打开=单点启用）。
                if (enable === this._activeGrantGlobalEnabled) return
                const created = await WKApp.apiClient.post(`obo/scopes`, {
                    grant_id: this._activeGrantId,
                    channel_id: this.channel.channelID,
                    channel_type: this.channel.channelType,
                    enabled: enable,
                }) as OboScope
                if (this._disposed) return
                this._oboScope = created
            }
            // task §1 spec #5：toggle 结束后强制 refresh，picking up any external
            // global_enabled 变化（如 PersonaEdit toggleGlobal）。
            await this.refreshOboScope()
        } catch (e: any) {
            if (this._disposed) return
            const msg = (e && typeof e === "object" && "msg" in e) ? (e as any).msg : "切换失败"
            Toast.error(typeof msg === "string" && msg.length > 0 ? msg : "切换失败")
            // 重新拉一次保持服务端真值
            await this.refreshOboScope()
        }
    }

    /**
     * 拉取「当前用户匹配本 channel 的 active grant + 本 channel 的 scope 状态」。
     *
     * 实现走 GET /v1/obo/grants 取全部 grants → 任挑第一个 active 的作为
     * _activeGrantId → GET /v1/obo/grants/{id}/scopes 取出 scope 列表 → 匹配
     * channel_id+channel_type。
     *
     * 失败：
     *   - 404 → _oboBackendMissing=true，跳过 toggle 渲染
     *   - 其他错误 → _oboScope 保持 undefined（不要降级成 null，会被 buildPersonaSection
     *     误判成「已加载、scope=off」），_oboScopeLoaded 保持 false，警告 console。
     *
     * 该方法**不**走 hasAnyActiveGrantCache —— 它要拿 grant.id, cache 只是 boolean。
     *
     * P1-2 联动：active grant 的筛选条件改成只看 `active`，不再 && global_enabled。
     * 否则 per-channel scope 模式（global off, 单 channel 开）下用户根本拿不到 grant.id,
     * toggle 点了 toggleOboScope 的 `if (!this._activeGrantId) return` 又会静默吞掉。
     */
    private async refreshOboScope(): Promise<void> {
        try {
            const grants = await WKApp.apiClient.get<OboGrant[]>(`obo/grants`)
            const list: OboGrant[] = Array.isArray(grants) ? grants : ((grants as any)?.items ?? [])
            const active = list.find((g) => g.active)
            if (this._disposed) return
            if (!active) {
                this._activeGrantId = undefined
                this._activeGrantGlobalEnabled = false
                this._oboScope = null
                this._oboScopeLoaded = true
                this.notifyListener()
                return
            }
            this._activeGrantId = active.id
            // Round-2 P1（YUJ-1193）：保留 global_enabled，否则 toggle 在 global=true /
            // 无 scope 场景会渲染成 OFF，与服务端实际行为相反。
            this._activeGrantGlobalEnabled = !!active.global_enabled
            const scopes = await WKApp.apiClient.get<OboScope[]>(`obo/grants/${active.id}/scopes`)
            if (this._disposed) return
            const arr: OboScope[] = Array.isArray(scopes) ? scopes : ((scopes as any)?.items ?? [])
            const match = arr.find((s) =>
                s.channel_id === this.channel.channelID && s.channel_type === this.channel.channelType,
            )
            this._oboScope = match || null
            this._oboScopeLoaded = true
        } catch (e: any) {
            if (this._disposed) return
            if (e && typeof e === "object" && "status" in e && (e as any).status === 404) {
                this._oboBackendMissing = true
            } else {
                // P1-3：非 404 错误时，不要把 _oboScope 改成 null（那样 buildPersonaSection
                // 会以为 scope 加载成功只是没记录，渲染出来一个点不动的 toggle）。
                // 保持 _oboScope=undefined + _oboScopeLoaded=false，让 toggle 整体隐藏。
                // 日后可加重试按钮 / Toast，但这一版至少不要 silently 出 broken UI。
                console.warn("[ChannelSetting] refreshOboScope failed (non-404):", e)
            }
        } finally {
            if (!this._disposed) {
                this.notifyListener()
            }
        }
    }

    didMount(): void {
        WKSDK.shared().channelManager.fetchChannelInfo(this.channel)

        this.reloadSubscribers()

        if(this.channel.channelType !== ChannelTypePerson) {
            this.subscriberChangeListener = () => {
                this.reloadSubscribers()
            }
            WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)

            // WKSDK.shared().channelManager.syncSubscribes(this.channel)

        }
        this.channelInfoListener = (channelInfo:ChannelInfo) => {
            if(channelInfo.channel.isEqual(this.channel)) {
                this.reloadChannelInfo()
                return
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        this.reloadChannelInfo()

        // OBO 分身 toggle 的两个异步前置:
        //   1. 刷新「我有没有 active grant」的全局缓存 → 决定 toggle 是否渲染
        //   2. 拉本 channel 的 scope 状态 → 决定 toggle 初始 checked
        // 两个 promise 都在 finally 里 notifyListener,让 sections() 重跑。
        // 失败不 Toast(详见 PersonaSettings/vm.tsx 的容错合约),静默隐藏 toggle。
        //
        // 非阻塞修复（YUJ-1178）：异步链路在 resolve 前可能 VM 已经 unmount，
        // 通过 _disposed 守卫避免对已销毁 Provider 触发 notifyListener。
        void refreshActiveGrantCache().finally(() => {
            if (this._disposed) return
            this.notifyListener()
            if (hasAnyActiveGrant() === true) {
                void this.refreshOboScope()
            }
        })

    }
    didUnMount(): void {
        // 标记销毁，让所有进行中的异步分支（refreshActiveGrantCache /
        // refreshOboScope）resolve 后 early-return，不再去 notifyListener。
        this._disposed = true
        if(this.subscriberChangeListener) {
            WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
        }
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }


    reloadSubscribers() {
        if(this.channel.channelType !== ChannelTypePerson) {
            this.subscribers = WKSDK.shared().channelManager.getSubscribes(this.channel)
            if(this.subscribers && this.subscribers.length>0) {
                for (const subscriber of this.subscribers) {
                    subscriber.channel = this.channel
                    if(subscriber.uid === WKApp.loginInfo.uid) {
                        this.subscriberOfMe = subscriber
                        this.routeData.subscriberOfMe = this.subscriberOfMe
                    }
                }
            }
            this.routeData.subscribers =   this.subscribers.filter((s)=>s.status === SubscriberStatus.normal)
            this.routeData.subscriberAll =this.subscribers

            this.notifyListener()
        }

    }

    reloadChannelInfo() {
        this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(this.channel)
        this.routeData.channelInfo = this.channelInfo

        if(this.channelInfo && this.channel.channelType === ChannelTypePerson) {
            this.subscribers = [{
                name: this.channelInfo.title,
                uid: this.channelInfo.channel.channelID,
                remark: this.channelInfo.title,
                avatar: WKApp.shared.avatarUser(this.channel.channelID),
                role: GroupRole.normal,
                status: 1,
                channel: this.channel,
                isDeleted: false,
                version: 0,
                orgData: {},
            }]
            this.routeData.subscribers =  this.subscribers
        }
        this.notifyListener()
    }
}