import React, { Component } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import { Toast, Modal, Form, Button } from "@douyinfe/semi-ui"
import WKApp from "../../App"
import WKAvatar from "../../Components/WKAvatar"
import { BotsTab, type BotsTabHandle } from "./BotsTab"
import { Bot, listBots } from "./botsApi"
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
    // When provided, the list shows management controls (New Agent / Add Bot)
    // scoped to this openclaw runtime. Omit to render as a read-only list.
    runtime?: AgentRuntime
    onChanged?: () => void
}

type ManagedAgentMode = "create-agent" | "add-bot"

interface AgentsListState {
    expanded: Set<string>
    modalMode: ManagedAgentMode | null
    modalAgentId: string | null   // only set for add-bot: which existing agent
    submitting: boolean
}

// ManagedAgent: server response shape for managed-agents endpoints
interface ManagedAgent {
    id: number
    agent_id: string
    space_id: string
    runtime_id: number
    daemon_id: string
    display_name: string
    provider: string
    bot_uid: string
    status: string
    error_msg?: string
    created_at: string
    updated_at: string
}

class AgentsList extends Component<AgentsListProps, AgentsListState> {
    state: AgentsListState = {
        expanded: new Set(),
        modalMode: null,
        modalAgentId: null,
        submitting: false,
    }

    componentDidMount() {
        // Auto-expand all agents on first mount so the user sees bots
        // without having to click each one.
        const expanded = new Set<string>(this.props.agents.map((a: any) => a.id))
        this.setState({ expanded })
    }

    toggle = (id: string) => {
        this.setState((prev) => {
            const expanded = new Set(prev.expanded)
            if (expanded.has(id)) expanded.delete(id)
            else expanded.add(id)
            return { expanded }
        })
    }

    private toggleAll = () => {
        const { agents } = this.props
        this.setState((prev) => {
            // If every agent is expanded → collapse all; otherwise → expand all.
            const allExpanded = agents.length > 0 && agents.every((a: any) => prev.expanded.has(a.id))
            const expanded = allExpanded ? new Set<string>() : new Set<string>(agents.map((a: any) => a.id))
            return { expanded }
        })
    }

    private openCreateAgent = () => {
        this.setState({ modalMode: "create-agent", modalAgentId: null })
    }

    private openAddBot = (agentId: string) => {
        this.setState({ modalMode: "add-bot", modalAgentId: agentId })
    }

    private closeModal = () => {
        if (this.state.submitting) return
        this.setState({ modalMode: null, modalAgentId: null })
    }

    private pollManagedAgent = async (id: number): Promise<ManagedAgent> => {
        const deadline = Date.now() + 60_000
        for (;;) {
            const ma: ManagedAgent = await WKApp.apiClient.get(`/runtimes/managed-agents/${id}`)
            if (ma.status === "active" || ma.status === "failed") return ma
            if (Date.now() > deadline) {
                return { ...ma, status: "failed", error_msg: "timeout waiting for daemon (60s)" }
            }
            await new Promise(r => setTimeout(r, 3000))
        }
    }

    private submitForm = async (values: { display_name: string }) => {
        const runtime = this.props.runtime
        const { modalMode, modalAgentId } = this.state
        if (!runtime || !modalMode) return
        this.setState({ submitting: true })
        try {
            let created: ManagedAgent
            if (modalMode === "create-agent") {
                created = await WKApp.apiClient.post("/runtimes/managed-agents", {
                    runtime_id: runtime.id,
                    display_name: values.display_name,
                })
                Toast.info(`Agent 已注册，等待 daemon 在本地 openclaw 创建 workspace…`)
            } else {
                // add-bot
                if (!modalAgentId) return
                created = await WKApp.apiClient.post(
                    `/runtimes/${runtime.id}/agents/${encodeURIComponent(modalAgentId)}/bots`,
                    { display_name: values.display_name },
                )
                Toast.info(`Bot ${created.bot_uid} 已 mint，等待 daemon 绑定到 ${modalAgentId}…`)
            }
            const final = await this.pollManagedAgent(created.id)
            if (final.status === "active") {
                Toast.success(
                    modalMode === "create-agent"
                        ? `Agent ${final.agent_id} 已创建`
                        : `Bot ${final.display_name} 已绑定到 ${final.agent_id}`
                )
            } else {
                Toast.error(`操作失败：${final.error_msg || "unknown error"}`)
            }
            this.setState({ modalMode: null, modalAgentId: null, submitting: false })
            // Daemon force-syncs server metadata before ack, so a single
            // refresh right after "active" is sufficient.
            this.props.onChanged?.()
        } catch (err: any) {
            console.error("managed agent op failed", err)
            const msg = err?.msg || err?.message || String(err)
            Toast.error(`操作失败：${msg}`)
            this.setState({ submitting: false })
        }
    }

    private renderModal() {
        const { modalMode, modalAgentId, submitting } = this.state
        if (!modalMode) return null
        const isAddBot = modalMode === "add-bot"
        return (
            <Modal
                title={isAddBot ? `给 ${modalAgentId} 添加 Bot` : "创建新 Agent"}
                visible
                onCancel={this.closeModal}
                footer={null}
                maskClosable={!submitting}
                width={420}
            >
                <Form onSubmit={this.submitForm}>
                    <Form.Input
                        field="display_name"
                        label={isAddBot ? "Bot 显示名" : "Agent 名称"}
                        placeholder={isAddBot ? "例如：my-bot" : "例如：caster"}
                        rules={[
                            { required: true, message: "必填" },
                            { max: 60, message: "最多 60 字符" },
                        ]}
                        disabled={submitting}
                    />
                    <div className="wk-rt-modal-footer">
                        <Button onClick={this.closeModal} disabled={submitting}>取消</Button>
                        <Button type="primary" theme="solid" htmlType="submit" loading={submitting}>
                            {isAddBot ? "添加 Bot" : "创建 Agent"}
                        </Button>
                    </div>
                </Form>
                <div className="wk-rt-modal-hint">
                    {isAddBot
                        ? `服务端会 mint 一个新 bot，等待下次 daemon heartbeat（最长 15s）通过 openclaw agents bind 绑定到 ${modalAgentId}。`
                        : "服务端只在本地 openclaw 创建一个 agent workspace（不会自动 mint bot）。创建完成后可在 agent 下面手动 Add Bot。"}
                </div>
            </Modal>
        )
    }

    render() {
        const { agents, runtime } = this.props
        const { expanded } = this.state
        const manageable = !!runtime && runtime.provider === "openclaw" && runtime.status === "online"
        const allExpanded = agents.length > 0 && agents.every((a: any) => expanded.has(a.id))

        return (
            <div className="wk-rt-managed-card">
                <div className="wk-rt-managed-header">
                    <span className="wk-rt-managed-title">Agents</span>
                    <span className="wk-rt-managed-count">{agents.length}</span>
                    {agents.length > 0 && (
                        <button
                            type="button"
                            className="wk-rt-managed-toggle-all"
                            onClick={this.toggleAll}
                            title={allExpanded ? "折叠全部" : "展开全部"}
                        >
                            {allExpanded ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="4 14 10 14 10 20" />
                                    <polyline points="20 10 14 10 14 4" />
                                    <line x1="14" y1="10" x2="21" y2="3" />
                                    <line x1="3" y1="21" x2="10" y2="14" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 3 21 3 21 9" />
                                    <polyline points="9 21 3 21 3 15" />
                                    <line x1="21" y1="3" x2="14" y2="10" />
                                    <line x1="3" y1="21" x2="10" y2="14" />
                                </svg>
                            )}
                            <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
                        </button>
                    )}
                    {manageable && (
                        <button
                            type="button"
                            className="wk-rt-managed-add"
                            onClick={this.openCreateAgent}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            <span>New Agent</span>
                        </button>
                    )}
                </div>

                {agents.length === 0 ? (
                    <div className="wk-rt-managed-empty">
                        <div className="wk-rt-managed-empty-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M9 9h6v6H9z" />
                            </svg>
                        </div>
                        <div className="wk-rt-managed-empty-text">No agents yet</div>
                        {manageable && (
                            <div className="wk-rt-managed-empty-hint">点击右上「+ New Agent」创建第一个</div>
                        )}
                    </div>
                ) : (
                    <div className="wk-rt-managed-list">
                        {agents.map((agent: any) => {
                            const isExpanded = expanded.has(agent.id)
                            const routeInfos = getRouteInfos(agent)
                            return (
                                <div key={agent.id} className="wk-rt-managed-agent">
                                    <div
                                        className="wk-rt-managed-agent-row wk-rt-clickable"
                                        onClick={() => this.toggle(agent.id)}
                                    >
                                        <div className={`wk-rt-managed-agent-icon${agent.is_default ? " default" : ""}`}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="3" y="11" width="18" height="10" rx="2" />
                                                <circle cx="12" cy="5" r="2" />
                                                <path d="M12 7v4" />
                                                <line x1="8" y1="16" x2="8" y2="16" />
                                                <line x1="16" y1="16" x2="16" y2="16" />
                                            </svg>
                                        </div>
                                        <div className="wk-rt-managed-agent-info">
                                            <div className="wk-rt-managed-agent-name">
                                                {agent.name || agent.id}
                                                {agent.is_default && <span className="wk-rt-default-tag">default</span>}
                                            </div>
                                            <div className="wk-rt-managed-agent-meta">
                                                {routeInfos.length} bot{routeInfos.length !== 1 ? "s" : ""}
                                            </div>
                                        </div>
                                        <svg
                                            className={`wk-rt-managed-chevron${isExpanded ? " expanded" : ""}`}
                                            width="16" height="16" viewBox="0 0 24 24"
                                            fill="none" stroke="currentColor"
                                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                        >
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </div>

                                    {isExpanded && (
                                        <div className="wk-rt-managed-bots">
                                            {routeInfos.length === 0 ? (
                                                <div className="wk-rt-managed-no-bots">No bots bound</div>
                                            ) : (
                                                routeInfos.map((info: RouteInfo, i: number) => (
                                                    <BotRouteRow key={info.raw || i} route={info} />
                                                ))
                                            )}
                                            {manageable && (
                                                <button
                                                    type="button"
                                                    className="wk-rt-managed-addbot"
                                                    onClick={(e) => { e.stopPropagation(); this.openAddBot(agent.id) }}
                                                >
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="12" y1="5" x2="12" y2="19" />
                                                        <line x1="5" y1="12" x2="19" y2="12" />
                                                    </svg>
                                                    <span>Add Bot</span>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                {this.renderModal()}
            </div>
        )
    }
}

// ─── BotsSection: list bots bound to this openclaw runtime, embedded in
//     RuntimeDetail. Row click hands off to the Bot tab via parent callback;
//     "+ 新建" likewise. Polls every 5s to mirror BotsTab so status
//     transitions (provisioning → active) reflect without a page refresh.
// ────────────────────────────────────────────────────────────────────────

const RTBOTS_PALETTE = [
    { bg: "#eef2f7", fg: "#3d4759" },
    { bg: "#eef5ee", fg: "#365940" },
    { bg: "#f5eef0", fg: "#5a3d4a" },
    { bg: "#f0f0f5", fg: "#3d3d5c" },
    { bg: "#f5f1e8", fg: "#5c4a2d" },
    { bg: "#e8f1f5", fg: "#2d4a5c" },
]

function rtbotsAvatarColor(name: string): { bg: string; fg: string } {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    return RTBOTS_PALETTE[h % RTBOTS_PALETTE.length]
}

function BotsSection({ runtime, onOpenBot, onCreateBot }: {
    runtime: AgentRuntime
    onOpenBot?: (id: number) => void
    onCreateBot?: () => void
}) {
    const [bots, setBots] = React.useState<Bot[]>([])
    const [loading, setLoading] = React.useState(true)

    const refresh = React.useCallback(async () => {
        try {
            const all = await listBots()
            setBots(all.filter(b => b.runtime_id === runtime.id && b.status !== "archived"))
        } catch {
            // swallow — leaves stale list visible; next poll will retry
        } finally {
            setLoading(false)
        }
    }, [runtime.id])

    React.useEffect(() => { refresh() }, [refresh])
    React.useEffect(() => {
        const t = window.setInterval(refresh, 5000)
        return () => window.clearInterval(t)
    }, [refresh])

    return (
        <div className="wk-rt-rtbots">
            <div className="wk-rt-rtbots__header">
                <span className="wk-rt-rtbots__title">智能体</span>
                <span className="wk-rt-rtbots__count">{bots.length}</span>
                {onCreateBot && (
                    <button
                        type="button"
                        className="wk-rt-rtbots__add"
                        onClick={onCreateBot}
                        title="在 Bot 标签页创建新智能体"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>新建</span>
                    </button>
                )}
            </div>
            {loading && bots.length === 0 ? (
                <div className="wk-rt-rtbots__empty">加载中…</div>
            ) : bots.length === 0 ? (
                <div className="wk-rt-rtbots__empty">这个 runtime 还没有智能体</div>
            ) : (
                <ul className="wk-rt-rtbots__list">
                    {bots.map(b => {
                        const av = rtbotsAvatarColor(b.name)
                        const statusKind: "online" | "failed" | "pending" =
                            b.status === "active" ? "online" :
                            b.status === "failed" ? "failed" : "pending"
                        const statusLabel =
                            b.status === "active" ? "在线" :
                            b.status === "failed" ? "失败" : "初始化中"
                        return (
                            <li
                                key={b.id}
                                className="wk-rt-rtbots__row"
                                role="button"
                                tabIndex={0}
                                title={`查看 ${b.name} 详情`}
                                onClick={() => onOpenBot?.(b.id)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault()
                                        onOpenBot?.(b.id)
                                    }
                                }}
                            >
                                <span
                                    className="wk-rt-rtbots__avatar"
                                    style={{ background: av.bg, color: av.fg }}
                                    aria-hidden="true"
                                >{b.name.slice(0, 1).toUpperCase()}</span>
                                <span className="wk-rt-rtbots__name">{b.name}</span>
                                <span className={`wk-rt-rtbots__status wk-rt-rtbots__status--${statusKind}`}>
                                    <span className="wk-rt-rtbots__dot" aria-hidden="true" />
                                    {statusLabel}
                                </span>
                                {b.workspace_id && (
                                    <span className="wk-rt-rtbots__ws" title={b.workspace_id}>{b.workspace_id}</span>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

// ─── RuntimeDetail: rendered in RIGHT panel when clicking an agent ──────

interface RuntimeDetailProps {
    runtime: AgentRuntime
    versionHints: Record<number, { has_update?: boolean; latest_version?: string; plugin_has_update?: boolean; plugin_latest_version?: string }>
    pluginActiveUpgrade?: ActiveUpgrade
    componentActiveUpgrade?: ActiveUpgrade
    onDelete: (id: number) => void
    onAgentsChanged?: () => void
    // PoC4: openclaw runtime detail surfaces a Bots section. These callbacks
    // hand off to the Bot tab (parent owns tab state + BotsTab ref).
    onOpenBot?: (botId: number) => void
    onCreateBot?: () => void
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
                component: "octo",
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
                                        onOpenBot={this.props.onOpenBot}
                                        onCreateBot={this.props.onCreateBot}
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
        if (hasUpdate && pluginName === "octo") {
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
                                        onOpenBot={this.props.onOpenBot}
                                        onCreateBot={this.props.onCreateBot}
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
                        const octoPlugin = ((metadata as any).plugins as any[]).find((p: any) => p.name === "octo")
                        const pluginHint = this.props.versionHints[rt.id]
                        return octoPlugin ? (
                            <div className="wk-rt-field">
                                <label>Octo Plugin</label>
                                <span className="wk-rt-mono">
                                    {octoPlugin.version}
                                    {pluginHint?.plugin_has_update && (
                                        <span className="wk-rt-update-hint"> → {pluginHint.plugin_latest_version}</span>
                                    )}
                                    {this.renderPluginUpgradeBtn("octo", pluginHint?.plugin_has_update)}
                                </span>
                            </div>
                        ) : null
                    })()}
                </div>

                <div className="wk-rt-detail-section">
                    <label>Daemon ID</label>
                    <span className="wk-rt-mono">{rt.daemon_id || "N/A"}</span>
                </div>

                {rt.provider === "openclaw" && (
                    <BotsSection
                        runtime={rt}
                        onOpenBot={this.props.onOpenBot}
                        onCreateBot={this.props.onCreateBot}
                    />
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

type ActiveTab = "runtime" | "bots"
interface RuntimesPageState extends RuntimesState {
    activeTab: ActiveTab
}

export default class RuntimesPage extends Component<{}, RuntimesPageState> {
    pingCache: PingCache = new Map()
    botsTabRef = React.createRef<BotsTabHandle>()

    state: RuntimesPageState = {
        runtimes: [],
        versionHints: {},
        daemonVersionHints: {},
        activeUpgrades: {},
        loading: true,
        selectedId: null,
        expandedDevices: new Set<string>(),
        activeTab: (new URLSearchParams(window.location.search).get("tab") === "bots" ? "bots" : "runtime"),
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
        const pluginUpgrade = this.state.activeUpgrades[`${rt.id}:octo`]
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
                onAgentsChanged={() => this.loadData()}
                onOpenBot={this.openBotFromRuntime}
                onCreateBot={this.createBotFromRuntime}
            />
        )
    }

    // Tab switch with optional after-hook. Used both by the tab buttons
    // and by the openBot/createBot bridge so the BotsTab ref is ready
    // before we try to call into it.
    private switchTab = (next: ActiveTab, after?: () => void) => {
        const sp = new URLSearchParams(window.location.search)
        if (next === "bots") sp.set("tab", "bots"); else sp.delete("tab")
        const q = sp.toString()
        window.history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""))
        if (this.state.activeTab === next) {
            // Already on target tab — defer the after-hook a microtask so
            // callers don't have to special-case sync vs async.
            if (after) Promise.resolve().then(after)
            return
        }
        WKApp.routeRight.popToRoot()
        this.setState({ activeTab: next }, after)
    }

    // Bridge: clicking a bot row inside a Runtime detail page switches to
    // the Bot tab, then asks BotsTab to surface that bot's detail panel.
    // openBot tolerates an unloaded list via pendingOpenIdRef.
    private openBotFromRuntime = (botId: number) => {
        this.switchTab("bots", () => {
            this.botsTabRef.current?.openBot(botId)
        })
    }

    private createBotFromRuntime = () => {
        this.switchTab("bots", () => {
            this.botsTabRef.current?.openCreate()
        })
    }

    render() {
        const { runtimes, selectedId, loading, expandedDevices, activeTab } = this.state
        const groups = groupByDevice(runtimes)
        const totalOnline = runtimes.filter(r => r.status === "online").length

        return (
            <div className="wk-rt-list">
                <div className="wk-rt-pageheader">
                    <nav className="wk-rt-pagetabs" role="tablist" aria-label="Runtimes / Bots">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === "runtime"}
                            className={`wk-rt-pagetab${activeTab === "runtime" ? " is-active" : ""}`}
                            onClick={() => this.switchTab("runtime")}
                        >Runtime</button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === "bots"}
                            className={`wk-rt-pagetab${activeTab === "bots" ? " is-active" : ""}`}
                            onClick={() => this.switchTab("bots")}
                        >Bot</button>
                        {activeTab === "runtime" && (
                            <span className="wk-rt-pageheader__meta" aria-live="polite">
                                {groups.length} device{groups.length !== 1 ? "s" : ""} · {totalOnline} online
                            </span>
                        )}
                        {activeTab === "bots" && (
                            <button
                                type="button"
                                className="wk-rt-pageheader__action"
                                onClick={() => this.botsTabRef.current?.openCreate()}
                            >+ 新建</button>
                        )}
                    </nav>
                </div>
                {activeTab === "bots" ? (
                    <BotsTab ref={this.botsTabRef} />
                ) : (
                    <div className="wk-rt-runtime-tab">
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
                )}
            </div>
        )
    }
}
