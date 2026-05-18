import React, { Component } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import { Toast } from "@douyinfe/semi-ui"
import WKApp from "../../App"
import WKAvatar from "../../Components/WKAvatar"
import "./index.css"

interface AgentRuntime {
    id: number
    name: string
    provider: string
    status: string
    version: string
    device_name: string
    device_info: string
    runtime_mode: string
    daemon_id: string
    metadata: string
    owner_uid: string
    last_seen_at: string
    created_at: string
    updated_at: string
}

interface DeviceGroup {
    daemonId: string
    deviceName: string
    runtimes: AgentRuntime[]
    onlineCount: number
    cliVersion: string
    osName: string
    arch: string
}

interface ActiveUpgrade {
    task_id: string
    daemon_id: string
    component: string
    runtime_id?: number
    status: string
    from_version: string
    to_version: string
    error_msg: string
}

// key 规则：
//  - daemon 升级 → `${daemon_id}:octo-daemon`
//  - 插件升级 → `${runtime_id}:${component}`
function upgradeKey(u: Pick<ActiveUpgrade, "daemon_id" | "component" | "runtime_id">): string {
    if (u.component === "octo-daemon") return `${u.daemon_id}:octo-daemon`
    return `${u.runtime_id || 0}:${u.component}`
}

interface RuntimesState {
    runtimes: AgentRuntime[]
    versionHints: Record<number, { has_update?: boolean; latest_version?: string; plugin_has_update?: boolean; plugin_latest_version?: string }>
    daemonVersionHints: Record<string, { has_update?: boolean; latest_version?: string; current?: string }>
    activeUpgrades: Record<string, ActiveUpgrade>
    loading: boolean
    selectedId: number | null
    expandedDevices: Set<string>
}

const providerColors: Record<string, string> = {
    claude: "#D97706",
    codex: "#059669",
    openclaw: "#DC2626",
    hermes: "#4B5563",
}

const providerLabels: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    openclaw: "OpenClaw",
    hermes: "Hermes",
}

function parseMetadata(raw: string): Record<string, unknown> | null {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
}

function formatLastSeen(lastSeen: string): string {
    if (!lastSeen) return "N/A"
    const ts = new Date(lastSeen.replace(" ", "T") + "Z").getTime()
    if (isNaN(ts)) return lastSeen
    const diff = Date.now() - ts
    if (diff < 60000) return "Just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
}

function groupByDevice(runtimes: AgentRuntime[]): DeviceGroup[] {
    const map = new Map<string, DeviceGroup>()
    for (const rt of runtimes) {
        const key = rt.daemon_id || "unknown"
        let group = map.get(key)
        if (!group) {
            const meta = parseMetadata(rt.metadata)
            let deviceInfo: Record<string, string> = {}
            if (rt.device_info) {
                try { deviceInfo = JSON.parse(rt.device_info) } catch {}
            }
            const osMap: Record<string, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" }
            group = {
                daemonId: key,
                deviceName: rt.device_name || key,
                runtimes: [],
                onlineCount: 0,
                cliVersion: (meta?.cli_version as string) || "",
                osName: osMap[deviceInfo.os] || deviceInfo.os || "",
                arch: deviceInfo.arch || "",
            }
            map.set(key, group)
        }
        group.runtimes.push(rt)
        if (rt.status === "online") group.onlineCount++
    }
    return Array.from(map.values())
}

// ─── DeviceDetail: rendered in RIGHT panel when clicking a device row ───

type PingCache = Map<string, { status: "done" | "error"; ms: number }>

interface DeviceDetailProps {
    group: DeviceGroup
    pingCache: PingCache
    daemonVersionHint?: { has_update?: boolean; latest_version?: string; current?: string }
    activeUpgrade?: ActiveUpgrade
}

interface DeviceDetailState {
    pingStatus: "idle" | "testing" | "done" | "error"
    pingMs: number
    upgradeStatus: "idle" | "pending" | "dispatched" | "downloading" | "installing" | "restarting" | "completed" | "failed" | "timeout"
    upgradeError: string
}

class DeviceDetail extends Component<DeviceDetailProps, DeviceDetailState> {
    private _unmounted = false

    constructor(props: DeviceDetailProps) {
        super(props)
        const cacheKey = `${WKApp.shared.currentSpaceId}:${props.group.daemonId}`
        const cached = props.pingCache.get(cacheKey)
        const upg = props.activeUpgrade
        const initUpgradeStatus = upg ? upg.status as any : "idle"
        const initUpgradeError = upg?.error_msg || ""
        this.state = cached
            ? { pingStatus: cached.status, pingMs: cached.ms, upgradeStatus: initUpgradeStatus, upgradeError: initUpgradeError }
            : { pingStatus: "idle", pingMs: 0, upgradeStatus: initUpgradeStatus, upgradeError: initUpgradeError }
    }

    private get cacheKey() {
        return `${WKApp.shared.currentSpaceId}:${this.props.group.daemonId}`
    }

    componentDidUpdate(prevProps: DeviceDetailProps) {
        if (prevProps.group.daemonId !== this.props.group.daemonId) {
            const cached = this.props.pingCache.get(this.cacheKey)
            const upg = this.props.activeUpgrade
            const upgStatus = upg ? upg.status as any : "idle"
            const upgError = upg?.error_msg || ""
            this.setState(cached
                ? { pingStatus: cached.status, pingMs: cached.ms, upgradeStatus: upgStatus, upgradeError: upgError }
                : { pingStatus: "idle", pingMs: 0, upgradeStatus: upgStatus, upgradeError: upgError }
            )
        }
    }

    componentWillUnmount() {
        this._unmounted = true
    }

    handlePing = async () => {
        this.setState({ pingStatus: "testing" })
        const daemonId = this.props.group.daemonId
        try {
            const initRes = await WKApp.apiClient.post("/runtimes/ping", { daemon_id: daemonId, space_id: WKApp.shared.currentSpaceId })
            const pingId = initRes.ping_id
            // Poll for result (max 15 seconds, every 1 second)
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const res = await WKApp.apiClient.get(`/runtimes/ping/${pingId}`)
                if (res.status === "done") {
                    this.setState({ pingStatus: "done", pingMs: res.rtt_ms })
                    this.props.pingCache.set(this.cacheKey, { status: "done", ms: res.rtt_ms })
                    return
                }
                if (res.status === "timeout") {
                    break
                }
            }
            this.setState({ pingStatus: "error" })
            this.props.pingCache.set(this.cacheKey, { status: "error", ms: 0 })
        } catch {
            this.setState({ pingStatus: "error" })
            this.props.pingCache.set(this.cacheKey, { status: "error", ms: 0 })
        }
    }

    handleUpgrade = async () => {
        this.setState({ upgradeStatus: "pending", upgradeError: "" })
        const daemonId = this.props.group.daemonId
        const isStale = () => this._unmounted || this.props.group.daemonId !== daemonId
        try {
            const initRes = await WKApp.apiClient.post("/runtimes/upgrade", { daemon_id: daemonId, space_id: WKApp.shared.currentSpaceId })
            const taskId = initRes.task_id
            for (let i = 0; i < 60; i++) {
                if (isStale()) return
                await new Promise(r => setTimeout(r, 2000))
                if (isStale()) return
                const res = await WKApp.apiClient.get(`/runtimes/upgrade/${taskId}`)
                if (isStale()) return
                this.setState({ upgradeStatus: res.status })
                if (res.status === "completed") {
                    this.setState({ upgradeStatus: "completed" })
                    await new Promise(r => setTimeout(r, 8000))
                    if (isStale()) return
                    for (let j = 0; j < 10; j++) {
                        if (isStale()) return
                        await new Promise(r => setTimeout(r, 2000))
                        if (isStale()) return
                        try {
                            const runtimesRes = await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId } })
                            if (isStale()) return
                            const hints = runtimesRes?.daemon_version_hints || {}
                            if (!hints[daemonId]?.has_update) {
                                const allRuntimes = runtimesRes?.runtimes || []
                                const groups = groupByDevice(allRuntimes)
                                const updated = groups.find((g: DeviceGroup) => g.daemonId === daemonId)
                                if (updated) {
                                    WKApp.routeRight.replaceToRoot(
                                        <DeviceDetail group={updated} pingCache={this.props.pingCache} daemonVersionHint={hints[daemonId]} />
                                    )
                                }
                                return
                            }
                        } catch {}
                    }
                    return
                }
                if (res.status === "failed" || res.status === "timeout") {
                    this.setState({ upgradeError: res.error_msg || res.status })
                    return
                }
            }
            this.setState({ upgradeStatus: "timeout", upgradeError: "polling timeout" })
        } catch (err: any) {
            this.setState({ upgradeStatus: "failed", upgradeError: err?.msg || err?.message || "upgrade failed" })
        }
    }

    render() {
        const { group } = this.props
        const { pingStatus, pingMs } = this.state
        const allOnline = group.onlineCount === group.runtimes.length && group.runtimes.length > 0
        const anyOnline = group.onlineCount > 0

        return (
            <div className="wk-rt-detail">
                <div className="wk-rt-detail-header">
                    <div className="wk-rt-device-icon large">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                    </div>
                    <div className="wk-rt-detail-title">
                        <h2>{group.deviceName}</h2>
                    </div>
                    <span className={`wk-rt-status-badge ${anyOnline ? "online" : "offline"}`}>
                        {allOnline ? "All Online" : anyOnline ? `${group.onlineCount}/${group.runtimes.length} Online` : "Offline"}
                    </span>
                </div>

                <div className="wk-rt-detail-grid">
                    <div className="wk-rt-field">
                        <label>Device Name</label>
                        <span>{group.deviceName}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Agents</label>
                        <span>{group.runtimes.length}</span>
                    </div>
                    {(group.osName || group.arch) && (
                        <div className="wk-rt-field">
                            <label>OS / Arch</label>
                            <span>{[group.osName, group.arch].filter(Boolean).join(" ")}</span>
                        </div>
                    )}
                    {group.cliVersion && (
                        <div className="wk-rt-field">
                            <label>Daemon Version</label>
                            <span className="wk-rt-mono">
                                {group.cliVersion}
                                {this.props.daemonVersionHint?.has_update && (
                                    <span className="wk-rt-update-hint"> → {this.props.daemonVersionHint.latest_version}</span>
                                )}
                                {this.props.daemonVersionHint?.has_update && (() => {
                                    const isWindows = group.osName?.toLowerCase() === "windows"
                                    const { upgradeStatus, upgradeError } = this.state
                                    const inProgress = upgradeStatus !== "idle" && upgradeStatus !== "completed" && upgradeStatus !== "failed" && upgradeStatus !== "timeout"

                                    if (upgradeStatus === "completed") {
                                        return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />Upgraded</span>
                                    }
                                    if (upgradeStatus === "failed" || upgradeStatus === "timeout") {
                                        return <span className="wk-rt-upgrade-status error" title={upgradeError}><span className="upgrade-dot" />Failed</span>
                                    }
                                    if (inProgress) {
                                        return <span className="wk-rt-upgrade-status progress"><span className="upgrade-dot" />{upgradeStatus}...</span>
                                    }
                                    if (isWindows) {
                                        return <span className="wk-rt-upgrade-btn disabled" title="Windows remote upgrade is not supported yet">Upgrade</span>
                                    }
                                    if (!anyOnline) return null
                                    return <span className="wk-rt-upgrade-btn" onClick={this.handleUpgrade}>Upgrade</span>
                                })()}
                            </span>
                        </div>
                    )}
                    <div className="wk-rt-field">
                        <label>Daemon ID</label>
                        <span className="wk-rt-mono">{group.daemonId}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Server Ping</label>
                        <span className="wk-rt-ping-result" onClick={this.handlePing}>
                            {pingStatus === "testing" && <span className="wk-rt-ping-dot testing" />}
                            {pingStatus === "done" && <><span className="wk-rt-ping-dot done" />{pingMs}ms</>}
                            {pingStatus === "error" && <><span className="wk-rt-ping-dot error" />Failed</>}
                            {pingStatus === "idle" && <><span className="wk-rt-ping-dot idle" />Click to test</>}
                        </span>
                    </div>
                </div>

                <div className="wk-rt-detail-section">
                    <label>Agents on this device</label>
                </div>
                <div className="wk-rt-device-agent-list">
                    {group.runtimes.map((rt) => (
                        <div key={rt.id} className="wk-rt-device-agent-row">
                            <div
                                className="wk-rt-provider-icon small"
                                style={{ background: providerColors[rt.provider] || "#6B7280" }}
                            >
                                {(providerLabels[rt.provider] || rt.provider).charAt(0).toUpperCase()}
                            </div>
                            <div className="wk-rt-device-agent-info">
                                <span className="wk-rt-device-agent-name">{providerLabels[rt.provider] || rt.provider}</span>
                                <span className="wk-rt-device-agent-ver">{rt.version}</span>
                            </div>
                            <div className={`wk-rt-status-dot ${rt.status === "online" ? "online" : "offline"}`} />
                        </div>
                    ))}
                </div>
            </div>
        )
    }
}

// ─── AgentsList: expandable agent rows with binding details ─────────────

// RouteInfo 对应服务端 modules/runtime/enrich.go 的 routeInfo 结构。
// 服务端 list 响应时往 metadata.agents[i].route_infos 注入；老数据/老服务端
// 可能只有 agent.routes (string[])，前端 fallback 解析（语义对齐 parseRouteInfo）。
interface RouteInfo {
    raw: string
    channel: string
    uid?: string
    name?: string
    account_id?: string
    is_bot: boolean
    online?: boolean
}

function parseLegacyRoute(r: string): RouteInfo {
    const slashIdx = r.indexOf("/")
    if (slashIdx <= 0) {
        return { raw: r, channel: "", account_id: r, is_bot: false }
    }
    const channel = r.slice(0, slashIdx)
    const accountId = r.slice(slashIdx + 1)
    return channel === "dmwork"
        ? { raw: r, channel, uid: accountId, is_bot: false }
        : { raw: r, channel, account_id: accountId, is_bot: false }
}

function getRouteInfos(agent: any): RouteInfo[] {
    if (Array.isArray(agent.route_infos)) return agent.route_infos
    // 防御异常数据：routes 里可能混入非 string
    return (agent.routes || [])
        .filter((r: any) => typeof r === "string")
        .map(parseLegacyRoute)
}

function copyMention(mention: string, e: React.MouseEvent) {
    e.stopPropagation()
    // 非安全上下文 / 权限被拒 / 某些 WebView 里 navigator.clipboard 可能不存在。
    // 用可选链 + execCommand fallback，任何一处失败走 warning toast。
    const ok = (text: string): Promise<void> | null => {
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text)
        }
        // fallback：临时 textarea + execCommand。textarea 在 finally 里兜底移除，
        // 防止 select/execCommand 抛错时 DOM 泄漏。
        let ta: HTMLTextAreaElement | null = null
        try {
            ta = document.createElement("textarea")
            ta.value = text
            ta.style.position = "fixed"
            ta.style.top = "-9999px"
            document.body.appendChild(ta)
            ta.select()
            const success = document.execCommand("copy")
            return success ? Promise.resolve() : null
        } catch {
            return null
        } finally {
            if (ta && ta.parentNode) {
                ta.parentNode.removeChild(ta)
            }
        }
    }
    const p = ok(mention)
    if (!p) {
        Toast.warning({ content: "当前环境不支持剪贴板复制", duration: 2 })
        return
    }
    p.then(
        () => Toast.success({ content: `已复制 ${mention}`, duration: 2 }),
        () => Toast.warning({ content: "复制失败", duration: 2 }),
    )
}

function BotRouteRow({ route }: { route: RouteInfo }) {
    if (route.is_bot && route.uid) {
        const channel = new Channel(route.uid, ChannelTypePerson)
        const mention = `@${route.uid}`
        const displayName = route.name || route.uid
        const showSecondary = route.name && route.name !== route.uid
        const openChat = (e: React.MouseEvent) => {
            e.stopPropagation()
            WKApp.endpoints.showConversation(channel)
        }
        return (
            <div className="wk-rt-binding-row wk-rt-binding-row-bot">
                <div
                    className="wk-rt-binding-avatar-wrap wk-rt-clickable"
                    title="打开与该 Bot 的私聊"
                    onClick={openChat}
                >
                    <WKAvatar channel={channel} style={{ width: 32, height: 32, borderRadius: "50%" }} />
                    {route.online && <span className="wk-rt-online-dot" title="Online" />}
                </div>
                <div className="wk-rt-binding-text">
                    <span
                        className="wk-rt-binding-primary wk-rt-clickable"
                        title="打开与该 Bot 的私聊"
                        onClick={openChat}
                    >
                        {displayName}
                    </span>
                    {showSecondary && (
                        <span
                            className="wk-rt-binding-mention"
                            title="点击复制 @mention"
                            onClick={(e) => copyMention(mention, e)}
                        >
                            {mention}
                        </span>
                    )}
                </div>
            </div>
        )
    }
    // fallback: 非 dmwork / uid 不合法（非 bot）
    const fallback = route.account_id || route.uid || "-"
    const fallbackMention = `@${fallback}`
    return (
        <div className="wk-rt-binding-row wk-rt-binding-row-legacy">
            <span className="wk-rt-binding-channel">{route.channel || "?"}</span>
            <span
                className="wk-rt-binding-mention"
                title="点击复制 @mention"
                onClick={(e) => copyMention(fallbackMention, e)}
            >
                {fallbackMention}
            </span>
        </div>
    )
}

interface AgentsListProps {
    agents: any[]
}

interface AgentsListState {
    expanded: Set<string>
}

class AgentsList extends Component<AgentsListProps, AgentsListState> {
    state: AgentsListState = { expanded: new Set() }

    toggle = (id: string) => {
        this.setState((prev) => {
            const expanded = new Set(prev.expanded)
            if (expanded.has(id)) expanded.delete(id)
            else expanded.add(id)
            return { expanded }
        })
    }

    render() {
        const { agents } = this.props
        const { expanded } = this.state

        return (
            <div className="wk-rt-device-agent-list" style={{ marginTop: 8 }}>
                {agents.map((agent: any) => {
                    const isExpanded = expanded.has(agent.id)
                    const routeInfos = getRouteInfos(agent)
                    return (
                        <div key={agent.id}>
                            <div
                                className="wk-rt-device-agent-row wk-rt-clickable"
                                onClick={() => this.toggle(agent.id)}
                            >
                                <div className="wk-rt-agent-badge">
                                    {agent.is_default ? "★" : "○"}
                                </div>
                                <div className="wk-rt-device-agent-info">
                                    <span className="wk-rt-device-agent-name">
                                        {agent.name || agent.id}
                                        {agent.is_default && <span className="wk-rt-default-tag">default</span>}
                                    </span>
                                    <span className="wk-rt-device-agent-ver">
                                        {agent.bindings} binding{agent.bindings !== 1 ? "s" : ""}
                                    </span>
                                </div>
                                <span className={`wk-rt-expand-arrow ${isExpanded ? "expanded" : ""}`}>&#9654;</span>
                            </div>
                            {isExpanded && routeInfos.length > 0 && (
                                <div className="wk-rt-binding-list">
                                    {routeInfos.map((info: RouteInfo, i: number) => (
                                        <BotRouteRow key={info.raw || i} route={info} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        )
    }
}

// ─── RuntimeDetail: rendered in RIGHT panel when clicking an agent ──────

interface RuntimeDetailProps {
    runtime: AgentRuntime
    versionHints: Record<number, { has_update?: boolean; latest_version?: string; plugin_has_update?: boolean; plugin_latest_version?: string }>
    pluginActiveUpgrade?: ActiveUpgrade
    componentActiveUpgrade?: ActiveUpgrade
    onDelete: (id: number) => void
}

type PluginUpgradeStatus = "idle" | "pending" | "dispatched" | "installing" | "completed" | "failed" | "timeout"

// 允许远程升级的 provider（和服务端 providerComponents / daemon componentUpgradeSpecs 保持一致）
const COMPONENT_UPGRADE_ENABLED = new Set<string>(["claude", "codex", "hermes", "openclaw"])

interface RuntimeDetailState {
    deleting: boolean
    pluginUpgradeStatus: PluginUpgradeStatus
    pluginUpgradeError: string
    componentUpgradeStatus: PluginUpgradeStatus
    componentUpgradeError: string
}

class RuntimeDetail extends Component<RuntimeDetailProps, RuntimeDetailState> {
    private _unmounted = false

    constructor(props: RuntimeDetailProps) {
        super(props)
        const pluginUpg = props.pluginActiveUpgrade
        const compUpg = props.componentActiveUpgrade
        this.state = {
            deleting: false,
            pluginUpgradeStatus: (pluginUpg?.status as PluginUpgradeStatus) || "idle",
            pluginUpgradeError: pluginUpg?.error_msg || "",
            componentUpgradeStatus: (compUpg?.status as PluginUpgradeStatus) || "idle",
            componentUpgradeError: compUpg?.error_msg || "",
        }
    }

    componentDidMount() {
        // WKApp.routeRight.replaceToRoot 有时真的会 unmount + remount 组件，
        // 此时原 handlePluginUpgrade 里的轮询协程 isStale() 退出，
        // 新实例若初始 state 是 in-progress，必须主动"续看轮询"，否则 state
        // 停留在 installing/dispatched 永不更新，用户要切页面才能跳出。
        const { pluginUpgradeStatus, componentUpgradeStatus } = this.state
        const pluginUpg = this.props.pluginActiveUpgrade
        if (pluginUpg?.task_id && (pluginUpgradeStatus === "pending" || pluginUpgradeStatus === "dispatched" || pluginUpgradeStatus === "installing")) {
            this.pollPluginUpgrade(pluginUpg.task_id, this.props.runtime.id)
        }
        const compUpg = this.props.componentActiveUpgrade
        if (compUpg?.task_id && (componentUpgradeStatus === "pending" || componentUpgradeStatus === "dispatched" || componentUpgradeStatus === "installing")) {
            this.pollComponentUpgrade(compUpg.task_id, this.props.runtime.id)
        }
    }

    componentDidUpdate(prevProps: RuntimeDetailProps) {
        if (prevProps.runtime.id !== this.props.runtime.id) {
            // 切换 runtime 时重置升级状态（从新 props 读）
            const pluginUpg = this.props.pluginActiveUpgrade
            const compUpg = this.props.componentActiveUpgrade
            this.setState({
                pluginUpgradeStatus: (pluginUpg?.status as PluginUpgradeStatus) || "idle",
                pluginUpgradeError: pluginUpg?.error_msg || "",
                componentUpgradeStatus: (compUpg?.status as PluginUpgradeStatus) || "idle",
                componentUpgradeError: compUpg?.error_msg || "",
            })
            return
        }

        // 关键：父组件每 15 秒 loadData 会刷新 *ActiveUpgrade props，
        // state 完全以最新 props 为准，不依赖本实例的轮询协程。
        // 轮询（handle*Upgrade / componentDidMount 续看）只是加速器。
        this.syncUpgradeStateFromProp(
            prevProps.pluginActiveUpgrade,
            this.props.pluginActiveUpgrade,
            "pluginUpgradeStatus",
            "pluginUpgradeError",
        )
        this.syncUpgradeStateFromProp(
            prevProps.componentActiveUpgrade,
            this.props.componentActiveUpgrade,
            "componentUpgradeStatus",
            "componentUpgradeError",
        )
    }

    private syncUpgradeStateFromProp(
        prev: ActiveUpgrade | undefined,
        curr: ActiveUpgrade | undefined,
        statusKey: "pluginUpgradeStatus" | "componentUpgradeStatus",
        errorKey: "pluginUpgradeError" | "componentUpgradeError",
    ) {
        const prevStatus = prev?.status
        const currStatus = curr?.status
        if (prevStatus === currStatus) return
        if (curr) {
            this.setState({
                [statusKey]: curr.status as PluginUpgradeStatus,
                [errorKey]: curr.error_msg || "",
            } as any)
        } else if (this.state[statusKey] !== "idle") {
            this.setState({ [statusKey]: "idle", [errorKey]: "" } as any)
        }
    }

    componentWillUnmount() {
        this._unmounted = true
    }

    handleDelete = async () => {
        if (!window.confirm("确定删除此 Runtime？")) return
        this.setState({ deleting: true })
        try {
            await WKApp.apiClient.delete(`/runtimes/${this.props.runtime.id}`)
            this.props.onDelete(this.props.runtime.id)
        } catch {
            this.setState({ deleting: false })
        }
    }

    handlePluginUpgrade = async () => {
        const rt = this.props.runtime
        const runtimeId = rt.id

        this.setState({ pluginUpgradeStatus: "pending", pluginUpgradeError: "" })
        try {
            const initRes = await WKApp.apiClient.post("/runtimes/upgrade", {
                runtime_id: runtimeId,
                daemon_id: rt.daemon_id,
                space_id: WKApp.shared.currentSpaceId,
                component: "openclaw-channel-dmwork",
            })
            await this.pollPluginUpgrade(initRes.task_id, runtimeId)
        } catch (err: any) {
            const msg = err?.msg || err?.message || "upgrade failed"
            this.setState({ pluginUpgradeStatus: "failed", pluginUpgradeError: msg })
        }
    }

    // 轮询已知 taskId 的进度。抽出复用于：1）首次点击 Upgrade；2）remount 后续看。
    pollPluginUpgrade = async (taskId: string, runtimeId: number) => {
        const isStale = () => this._unmounted || this.props.runtime.id !== runtimeId
        for (let i = 0; i < 200; i++) {
            if (isStale()) return
            await new Promise(r => setTimeout(r, 3000))
            if (isStale()) return
            let res: any
            try {
                res = await WKApp.apiClient.get(`/runtimes/upgrade/${taskId}`)
            } catch {
                continue
            }
            if (isStale()) return
            this.setState({ pluginUpgradeStatus: res.status, pluginUpgradeError: res.error_msg || "" })
            if (res.status === "completed") {
                await new Promise(r => setTimeout(r, 8000))
                if (isStale()) return
                for (let j = 0; j < 10; j++) {
                    if (isStale()) return
                    await new Promise(r => setTimeout(r, 2000))
                    if (isStale()) return
                    try {
                        const runtimesRes = await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId } })
                        if (isStale()) return
                        const hints = runtimesRes?.version_hints || {}
                        if (!hints[runtimeId]?.plugin_has_update) {
                            const allRuntimes = runtimesRes?.runtimes || []
                            const updated = allRuntimes.find((r: AgentRuntime) => r.id === runtimeId)
                            if (updated) {
                                WKApp.routeRight.replaceToRoot(
                                    <RuntimeDetail
                                        runtime={updated}
                                        versionHints={hints}
                                        onDelete={this.props.onDelete}
                                    />
                                )
                            }
                            return
                        }
                    } catch {
                        // ignore, keep polling
                    }
                }
                return
            }
            if (res.status === "failed" || res.status === "timeout") {
                return
            }
        }
        this.setState({ pluginUpgradeStatus: "timeout", pluginUpgradeError: "polling timeout" })
    }

    renderPluginUpgradeBtn(pluginName: string, hasUpdate: boolean | undefined) {
        const { pluginUpgradeStatus, pluginUpgradeError } = this.state
        if (pluginUpgradeStatus === "completed") {
            return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />Completed</span>
        }
        if (pluginUpgradeStatus === "failed" || pluginUpgradeStatus === "timeout") {
            return (
                <span className="wk-rt-upgrade-status error" title={pluginUpgradeError}>
                    <span className="upgrade-dot" />
                    {pluginUpgradeStatus === "timeout" ? "Timeout" : "Failed"}
                </span>
            )
        }
        if (pluginUpgradeStatus !== "idle") {
            return (
                <span className="wk-rt-upgrade-status progress">
                    <span className="upgrade-dot" />
                    {pluginUpgradeStatus}
                </span>
            )
        }
        if (hasUpdate && pluginName === "openclaw-channel-dmwork") {
            return <span className="wk-rt-upgrade-btn" onClick={this.handlePluginUpgrade}>Upgrade</span>
        }
        return null
    }

    // ── Component 升级（claude/codex/hermes/openclaw） ──────────────────────

    handleComponentUpgrade = async () => {
        const rt = this.props.runtime
        const runtimeId = rt.id
        const component = rt.provider

        this.setState({ componentUpgradeStatus: "pending", componentUpgradeError: "" })
        try {
            const initRes = await WKApp.apiClient.post("/runtimes/upgrade", {
                runtime_id: runtimeId,
                daemon_id: rt.daemon_id,
                space_id: WKApp.shared.currentSpaceId,
                component,
            })
            await this.pollComponentUpgrade(initRes.task_id, runtimeId)
        } catch (err: any) {
            const msg = err?.msg || err?.message || "upgrade failed"
            this.setState({ componentUpgradeStatus: "failed", componentUpgradeError: msg })
        }
    }

    pollComponentUpgrade = async (taskId: string, runtimeId: number) => {
        const isStale = () => this._unmounted || this.props.runtime.id !== runtimeId
        for (let i = 0; i < 200; i++) {
            if (isStale()) return
            await new Promise(r => setTimeout(r, 3000))
            if (isStale()) return
            let res: any
            try {
                res = await WKApp.apiClient.get(`/runtimes/upgrade/${taskId}`)
            } catch {
                continue
            }
            if (isStale()) return
            this.setState({ componentUpgradeStatus: res.status, componentUpgradeError: res.error_msg || "" })
            if (res.status === "completed") {
                // 服务端关单（register 匹配新版本）后再刷一次 runtimes 拿最新 version_hints
                await new Promise(r => setTimeout(r, 8000))
                if (isStale()) return
                for (let j = 0; j < 10; j++) {
                    if (isStale()) return
                    await new Promise(r => setTimeout(r, 2000))
                    if (isStale()) return
                    try {
                        const runtimesRes = await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId } })
                        if (isStale()) return
                        const hints = runtimesRes?.version_hints || {}
                        if (!hints[runtimeId]?.has_update) {
                            const allRuntimes = runtimesRes?.runtimes || []
                            const updated = allRuntimes.find((r: AgentRuntime) => r.id === runtimeId)
                            if (updated) {
                                WKApp.routeRight.replaceToRoot(
                                    <RuntimeDetail
                                        runtime={updated}
                                        versionHints={hints}
                                        onDelete={this.props.onDelete}
                                    />
                                )
                            }
                            return
                        }
                    } catch {
                        // ignore, keep polling
                    }
                }
                return
            }
            if (res.status === "failed" || res.status === "timeout") {
                return
            }
        }
        this.setState({ componentUpgradeStatus: "timeout", componentUpgradeError: "polling timeout" })
    }

    renderComponentUpgradeBtn(hasUpdate: boolean | undefined) {
        const rt = this.props.runtime
        if (!COMPONENT_UPGRADE_ENABLED.has(rt.provider)) return null

        const { componentUpgradeStatus, componentUpgradeError } = this.state
        if (componentUpgradeStatus === "completed") {
            return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />Completed</span>
        }
        if (componentUpgradeStatus === "failed" || componentUpgradeStatus === "timeout") {
            return (
                <span className="wk-rt-upgrade-status error" title={componentUpgradeError}>
                    <span className="upgrade-dot" />
                    {componentUpgradeStatus === "timeout" ? "Timeout" : "Failed"}
                </span>
            )
        }
        if (componentUpgradeStatus !== "idle") {
            return (
                <span className="wk-rt-upgrade-status progress">
                    <span className="upgrade-dot" />
                    {componentUpgradeStatus}
                </span>
            )
        }
        if (hasUpdate) {
            return <span className="wk-rt-upgrade-btn" onClick={this.handleComponentUpgrade}>Upgrade</span>
        }
        return null
    }

    render() {
        const { runtime: rt } = this.props
        const { deleting } = this.state
        const isOnline = rt.status === "online"
        const metadata = parseMetadata(rt.metadata)

        return (
            <div className="wk-rt-detail">
                <div className="wk-rt-detail-header">
                    <div
                        className="wk-rt-provider-icon large"
                        style={{ background: providerColors[rt.provider] || "#6B7280" }}
                    >
                        {(providerLabels[rt.provider] || rt.provider).charAt(0).toUpperCase()}
                    </div>
                    <div className="wk-rt-detail-title">
                        <h2>{rt.name}</h2>
                    </div>
                    <div className="wk-rt-detail-actions">
                        <span className={`wk-rt-status-badge ${isOnline ? "online" : "offline"}`}>
                            {isOnline ? "Online" : "Offline"}
                        </span>
                    </div>
                </div>

                <div className="wk-rt-detail-grid">
                    <div className="wk-rt-field">
                        <label>Runtime Mode</label>
                        <span>{rt.runtime_mode}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Provider</label>
                        <span>{providerLabels[rt.provider] || rt.provider}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Status</label>
                        <span className={isOnline ? "wk-rt-text-online" : "wk-rt-text-offline"}>{rt.status}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Last Seen</label>
                        <span>{formatLastSeen(rt.last_seen_at)}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Version</label>
                        <span className="wk-rt-mono">
                            {rt.version || "N/A"}
                            {this.props.versionHints[rt.id]?.has_update && (
                                <span className="wk-rt-update-hint"> → {this.props.versionHints[rt.id].latest_version}</span>
                            )}
                            {this.renderComponentUpgradeBtn(this.props.versionHints[rt.id]?.has_update)}
                        </span>
                    </div>
                    <div className="wk-rt-field">
                        <label>Device</label>
                        <span>{rt.device_name || "N/A"}</span>
                    </div>
                    {metadata && Array.isArray((metadata as any).plugins) && (() => {
                        const dmworkPlugin = ((metadata as any).plugins as any[]).find((p: any) => p.name === "openclaw-channel-dmwork")
                        const pluginHint = this.props.versionHints[rt.id]
                        return dmworkPlugin ? (
                            <div className="wk-rt-field">
                                <label>DMWork Plugin</label>
                                <span className="wk-rt-mono">
                                    {dmworkPlugin.version}
                                    {pluginHint?.plugin_has_update && (
                                        <span className="wk-rt-update-hint"> → {pluginHint.plugin_latest_version}</span>
                                    )}
                                    {this.renderPluginUpgradeBtn("openclaw-channel-dmwork", pluginHint?.plugin_has_update)}
                                </span>
                            </div>
                        ) : null
                    })()}
                </div>

                <div className="wk-rt-detail-section">
                    <label>Daemon ID</label>
                    <span className="wk-rt-mono">{rt.daemon_id || "N/A"}</span>
                </div>

                {metadata && Array.isArray((metadata as any).agents) && (metadata as any).agents.length > 0 && (
                    <div className="wk-rt-detail-section">
                        <label>{providerLabels[rt.provider] || rt.provider} Agents</label>
                        <AgentsList agents={(metadata as any).agents as any[]} />
                    </div>
                )}

                <div className="wk-rt-detail-footer">
                    <span>Created: {rt.created_at}</span>
                    <span>Updated: {rt.updated_at}</span>
                </div>
                {deleting && <div className="wk-rt-deleting-overlay">Deleting...</div>}
            </div>
        )
    }
}

// ─── RuntimesPage: two-level list (Device → Agent) ─────────────────────

export default class RuntimesPage extends Component<{}, RuntimesState> {
    pingCache: PingCache = new Map()

    state: RuntimesState = {
        runtimes: [],
        versionHints: {},
        daemonVersionHints: {},
        activeUpgrades: {},
        loading: true,
        selectedId: null,
        expandedDevices: new Set<string>(),
    }

    private pollTimer?: ReturnType<typeof setInterval>
    private selectedDaemonId?: string

    private handleSpaceChanged = () => {
        this.pingCache.clear()
        this.setState({ selectedId: null, expandedDevices: new Set() })
        WKApp.routeRight.popToRoot()
        this.loadData()
    }

    componentDidMount() {
        this.loadData()
        this.pollTimer = setInterval(() => this.loadData(true), 15000)
        WKApp.mittBus.on("space-changed", this.handleSpaceChanged)
    }

    componentWillUnmount() {
        if (this.pollTimer) clearInterval(this.pollTimer)
        WKApp.mittBus.off("space-changed", this.handleSpaceChanged)
    }

    async loadData(silent = false) {
        if (!silent) this.setState({ loading: true })
        try {
            const spaceId = WKApp.shared.currentSpaceId
            if (!spaceId) {
                this.setState({ runtimes: [], loading: false })
                return
            }
            const res = await WKApp.apiClient.get("/runtimes", { param: { space_id: spaceId } })
            // Compatible with both array (old) and object (new) response
            const runtimes: AgentRuntime[] = Array.isArray(res) ? res : (res?.runtimes || [])
            const versionHints = Array.isArray(res) ? {} : (res?.version_hints || {})
            const daemonVersionHints = Array.isArray(res) ? {} : (res?.daemon_version_hints || {})
            // active_upgrades 从服务端返回：数组 []ActiveUpgrade（新）或 map（旧）。前端统一转为按 key 索引的 map
            const rawUpgrades = Array.isArray(res) ? [] : (res?.active_upgrades || [])
            const activeUpgrades: Record<string, ActiveUpgrade> = {}
            if (Array.isArray(rawUpgrades)) {
                for (const u of rawUpgrades as ActiveUpgrade[]) {
                    activeUpgrades[upgradeKey(u)] = u
                }
            } else {
                // 旧 map 响应：key 是 daemon_id，仅 daemon 升级
                for (const [dId, v] of Object.entries(rawUpgrades as Record<string, any>)) {
                    const u: ActiveUpgrade = {
                        task_id: v.task_id,
                        daemon_id: dId,
                        component: "octo-daemon",
                        status: v.status,
                        from_version: v.from_version,
                        to_version: v.to_version,
                        error_msg: v.error_msg,
                    }
                    activeUpgrades[upgradeKey(u)] = u
                }
            }
            this.setState(
                (prev) => {
                    const expanded = new Set(prev.expandedDevices)
                    if (prev.expandedDevices.size === 0 && runtimes.length > 0) {
                        const groups = groupByDevice(runtimes)
                        groups.forEach(g => expanded.add(g.daemonId))
                    }
                    return { runtimes, versionHints, daemonVersionHints, activeUpgrades, loading: false, expandedDevices: expanded }
                },
                () => {
                    // 放 callback 里：保证 showAgentDetail / showDeviceDetail 里读到的
                    // this.state.activeUpgrades 是本轮刚拉到的，而不是 setState 之前的快照
                    if (silent && WKApp.route.currentPath === "/runtimes") {
                        if (this.state.selectedId != null) {
                            const updated = runtimes.find(r => r.id === this.state.selectedId)
                            if (updated) {
                                this.showAgentDetail(updated)
                            } else {
                                this.setState({ selectedId: null })
                                WKApp.routeRight.popToRoot()
                            }
                        } else if (this.selectedDaemonId && activeUpgrades[`${this.selectedDaemonId}:octo-daemon`]) {
                            const groups = groupByDevice(runtimes)
                            const updated = groups.find(g => g.daemonId === this.selectedDaemonId)
                            if (updated) {
                                this.showDeviceDetail(updated)
                            }
                        }
                    }
                },
            )
        } catch {
            if (!silent) this.setState({ loading: false })
        }
    }

    toggleDevice = (daemonId: string) => {
        this.setState((prev) => {
            const expanded = new Set(prev.expandedDevices)
            if (expanded.has(daemonId)) {
                expanded.delete(daemonId)
            } else {
                expanded.add(daemonId)
            }
            return { expandedDevices: expanded }
        })
    }

    showDeviceDetail = (group: DeviceGroup) => {
        this.setState({ selectedId: null })
        this.selectedDaemonId = group.daemonId
        WKApp.routeRight.replaceToRoot(
            <DeviceDetail
                group={group}
                pingCache={this.pingCache}
                daemonVersionHint={this.state.daemonVersionHints[group.daemonId]}
                activeUpgrade={this.state.activeUpgrades[`${group.daemonId}:octo-daemon`]}
            />
        )
    }

    showAgentDetail = (rt: AgentRuntime) => {
        this.setState({ selectedId: rt.id })
        this.selectedDaemonId = undefined
        const pluginUpgrade = this.state.activeUpgrades[`${rt.id}:openclaw-channel-dmwork`]
        const componentUpgrade = this.state.activeUpgrades[`${rt.id}:${rt.provider}`]
        WKApp.routeRight.replaceToRoot(
            <RuntimeDetail
                runtime={rt}
                versionHints={this.state.versionHints}
                pluginActiveUpgrade={pluginUpgrade}
                componentActiveUpgrade={componentUpgrade}
                onDelete={() => {
                    this.setState({ selectedId: null })
                    WKApp.routeRight.popToRoot()
                    this.loadData()
                }}
            />
        )
    }

    render() {
        const { runtimes, selectedId, loading, expandedDevices } = this.state
        const groups = groupByDevice(runtimes)
        const totalOnline = runtimes.filter(r => r.status === "online").length

        return (
            <div className="wk-rt-list">
                <div className="wk-rt-list-header">
                    <span className="wk-rt-list-title">Runtimes</span>
                    <span className="wk-rt-list-count">
                        {groups.length} device{groups.length !== 1 ? "s" : ""} · {totalOnline} online
                    </span>
                </div>
                <div className="wk-rt-list-items">
                    {loading && <div className="wk-rt-empty">Loading...</div>}
                    {!loading && groups.length === 0 && (
                        <div className="wk-rt-empty">No runtimes registered</div>
                    )}
                    {groups.map((group) => {
                        const expanded = expandedDevices.has(group.daemonId)
                        const anyOnline = group.onlineCount > 0
                        return (
                            <div key={group.daemonId} className="wk-rt-device-group">
                                {/* Level 1: Device */}
                                <div
                                    className="wk-rt-device-row"
                                    onClick={() => this.toggleDevice(group.daemonId)}
                                >
                                    <span className={`wk-rt-expand-arrow ${expanded ? "expanded" : ""}`}>&#9654;</span>
                                    <div className="wk-rt-device-icon">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                                            <line x1="8" y1="21" x2="16" y2="21"/>
                                            <line x1="12" y1="17" x2="12" y2="21"/>
                                        </svg>
                                    </div>
                                    <div
                                        className="wk-rt-device-info"
                                        onClick={(e) => { e.stopPropagation(); this.showDeviceDetail(group) }}
                                    >
                                        <div className="wk-rt-device-name">{group.deviceName}</div>
                                        <div className="wk-rt-device-sub">
                                            {group.runtimes.length} agent{group.runtimes.length !== 1 ? "s" : ""}
                                                                                    </div>
                                    </div>
                                    <div className={`wk-rt-status-dot ${anyOnline ? "online" : "offline"}`} />
                                </div>

                                {/* Level 2: Agents */}
                                {expanded && group.runtimes.map((rt) => (
                                    <div
                                        key={rt.id}
                                        className={`wk-rt-agent-row ${selectedId === rt.id ? "selected" : ""}`}
                                        onClick={() => this.showAgentDetail(rt)}
                                    >
                                        <div
                                            className="wk-rt-provider-icon small"
                                            style={{ background: providerColors[rt.provider] || "#6B7280" }}
                                        >
                                            {(providerLabels[rt.provider] || rt.provider).charAt(0).toUpperCase()}
                                        </div>
                                        <div className="wk-rt-list-item-info">
                                            <div className="wk-rt-list-item-name">
                                                {providerLabels[rt.provider] || rt.provider}
                                            </div>
                                            <div className="wk-rt-list-item-sub">{rt.version}</div>
                                        </div>
                                        <div className={`wk-rt-status-dot ${rt.status === "online" ? "online" : "offline"}`} />
                                    </div>
                                ))}
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }
}
