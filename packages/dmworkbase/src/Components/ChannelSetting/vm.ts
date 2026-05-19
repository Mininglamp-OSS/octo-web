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

        const checked = !!(this._oboScope && this._oboScope.enabled)
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
     * 行为：
     *   - 打开 → 若 _oboScope == null（不存在记录）POST /v1/obo/scopes 新增；
     *           若已存在但 enabled=false，理论上应 PUT 但 v0 接口不支持 PATCH 单 scope
     *           → 先 DELETE 再 POST。
     *   - 关闭 → DELETE 当前 scope。
     *
     * 任何错误都 Toast 提示并保持当前 _oboScope 不变（让 UI 回滚 toggle）。
     */
    private async toggleOboScope(enable: boolean): Promise<void> {
        if (!this._activeGrantId) return
        try {
            if (enable) {
                if (this._oboScope) {
                    // 已存在但 disabled —— 先删后建（v0 简单语义，避免引入 PUT）。
                    await WKApp.apiClient.delete(`/v1/obo/scopes/${this._oboScope.id}`)
                }
                const created = await WKApp.apiClient.post(`/v1/obo/scopes`, {
                    grant_id: this._activeGrantId,
                    channel_id: this.channel.channelID,
                    channel_type: this.channel.channelType,
                    enabled: true,
                }) as OboScope
                this._oboScope = created
            } else {
                if (this._oboScope) {
                    await WKApp.apiClient.delete(`/v1/obo/scopes/${this._oboScope.id}`)
                }
                this._oboScope = null
            }
        } catch (e: any) {
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
            const grants = await WKApp.apiClient.get<OboGrant[]>(`/v1/obo/grants`)
            const list: OboGrant[] = Array.isArray(grants) ? grants : []
            const active = list.find((g) => g.active)
            if (this._disposed) return
            if (!active) {
                this._activeGrantId = undefined
                this._oboScope = null
                this._oboScopeLoaded = true
                this.notifyListener()
                return
            }
            this._activeGrantId = active.id
            const scopes = await WKApp.apiClient.get<OboScope[]>(`/v1/obo/grants/${active.id}/scopes`)
            if (this._disposed) return
            const arr: OboScope[] = Array.isArray(scopes) ? scopes : []
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