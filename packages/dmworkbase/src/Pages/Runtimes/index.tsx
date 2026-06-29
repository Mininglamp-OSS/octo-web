import React, { Component } from "react"
import WKSDK, { Channel, ChannelTypePerson } from "wukongimjssdk"
import { Toast, Modal, Form, Button } from "@douyinfe/semi-ui"
import WKApp from "../../App"
import WKAvatar from "../../Components/WKAvatar"
import { BotsTab, type BotsTabHandle } from "./BotsTab"
import { CreateRuntimeModal } from "./CreateRuntimeModal"
import { octoComponentName } from "./octoComponent"
import { deviceRuntimeMode } from "./deviceRuntimeMode"
import { canInstallOctoPlugin, octoPluginInstalled, shouldShowCcInstall } from "./pluginInstall"
import { CcInstallModal } from "./CcInstallModal"
import { canCreateBot } from "./botGating"
import { Bot, botStatusLabel, listBots, providerLabels, fleetApiBase } from "./botsApi"
import { ProviderLogo } from "./providerLogos"
import { i18n, t } from "../../i18n"
import "./index.css"

interface AgentRuntime {
    id: number
    name: string
    provider: string
    status: string
    version: string
    device_id: number
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

// Device 对应 /runtimes 响应新增的顶层 `devices` map 的 value (key 是
// device_id 字符串). 设备成为一等公民: 设备名/OS/架构/系统版本/状态/最近
// 活跃/核心组件版本 都由服务端直接给出, 不再靠解析 runtime 的 device_info
// / metadata 字符串. daemon_id 也在 device 上, 空设备 (未装任何 agent 框架
// → 0 runtime) 仍能拿到 daemon_id 触发 daemon 升级.
interface DeviceComponent {
    name: string
    version: string
}

interface Device {
    device_id: number
    device_uuid: string
    daemon_id: string
    name: string
    os: string
    arch: string
    os_version: string
    status: string
    last_seen_at: string
    components: DeviceComponent[]
}

// DeviceGroup = 一台设备 (来自权威 devices map) + 串联到它的 runtimes.
// key 是设备身份 (String(device_id)), 用作左树展开/选中标识; daemon_id 仅
// 用于 daemon 升级 POST 与 activeUpgrade key.
interface DeviceGroup {
    key: string
    device: Device
    runtimes: AgentRuntime[]
    onlineCount: number
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
    // 权威设备列表 (key = device_id 字符串). 左树 Level-1 以此为准, 空设备
    // (无关联 runtime) 也显示.
    devices: Record<string, Device>
    versionHints: Record<number, { has_update?: boolean; latest_version?: string; has_plugin_update?: boolean; plugin_latest_version?: string; plugin_install_version?: string }>
    // daemon 版本升级提示, key 由 daemon_id 改为 device_id 字符串 (与 devices map 对齐).
    daemonVersionHints: Record<string, { has_update?: boolean; latest_version?: string; current?: string }>
    activeUpgrades: Record<string, ActiveUpgrade>
    loading: boolean
    selectedId: number | null
    expandedDevices: Set<string>
    // cc install modal lives at page level (not inside RuntimeDetail) so the
    // entered gateway/key/model survives the detail pane's 15s-poll re-push /
    // remount. Holds the runtime captured when the install button was clicked.
    ccInstallTarget: AgentRuntime | null
    // After the modal is submitted, the install request is handed to RuntimeDetail
    // as a one-shot prop so it runs through the polled handlePluginUpgrade
    // lifecycle (terminal failed/timeout stay visible). token makes it idempotent
    // across detail re-pushes; cleared once the detail reports it consumed.
    pendingCcInstall: { token: number; runtimeId: number; component: string; secret: { gatewayUrl: string; apiKey: string; model?: string } } | null
}

// providerLabels 已抽到 botsApi.ts (单源 export), CreateBotModal 也共用同
// 一份, 避免 "kind 列表用裸 'claude' / detail 显示 'Claude Code'" 三层
// 概念名漂移 (术语统一).

function parseMetadata(raw: string): Record<string, unknown> | null {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
}

// humanizeLastSeen: ISO 时间戳 -> "刚刚" / "X 分钟前" / "X 小时前" / "X 天前".
// 用于 DeviceDetail "最近活跃" 字段.
//
// ⚠️ 时区前提: fleet 写 last_seen_at 用 MySQL NOW(), 字符串 'YYYY-MM-DD HH:MM:SS'
// 不带 timezone marker. 前端 + 'Z' 按 UTC 解析 — 这要求 **server tz = UTC**
// (testenv-mysql container 默认 UTC, 已 verify NOW()===UTC_TIMESTAMP()).
// 若 prod mysql 配本地时区, last_seen_at 写的是本地时间, 前端按 UTC 解析
// 会偏 (e.g. UTC+8 sever 写 20:00, 前端按 20:00Z 解析 → 算成本地 28:00 即
// 第二天 04:00 → diff 是负值 → 显示"刚刚"但其实显示永远卡在"刚刚").
//
// TODO(PR-N): 让 fleet/server 返 RFC3339 with timezone (e.g. 2026-06-12T04:11:31Z)
// 而非 naive 'YYYY-MM-DD HH:MM:SS', 前端就不需要假设. 当前 docker testenv +
// k8s prod 都配 UTC 是项目约定.
function humanizeAge(epochMs: number): string {
    if (!epochMs) return "—"
    const diff = Date.now() - epochMs
    if (diff < 0)          return "—"
    if (diff < 60_000)     return t("base.runtimes.time.justNow")
    if (diff < 3_600_000)  return t("base.runtimes.time.minutesAgo", { values: { n: Math.floor(diff / 60_000) } })
    if (diff < 86_400_000) return t("base.runtimes.time.hoursAgo", { values: { n: Math.floor(diff / 3_600_000) } })
    return t("base.runtimes.time.daysAgo", { values: { n: Math.floor(diff / 86_400_000) } })
}

const OS_LABELS: Record<string, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" }
function osLabel(os: string): string {
    return OS_LABELS[os] || os || ""
}

// 'YYYY-MM-DD HH:MM:SS' (naive, server tz=UTC 约定, 见 humanizeAge 注释) → epoch ms (无效返 0).
function parseNaiveMs(s: string): number {
    if (!s) return 0
    const ts = new Date(s.replace(" ", "T") + "Z").getTime()
    return isNaN(ts) ? 0 : ts
}

// device 级 Daemon 版本: 从 components 取 octo-daemon 的 version (新接口权威源,
// 替代旧的 metadata.cli_version).
function daemonVersion(device: Device): string {
    return device.components?.find(c => c.name === "octo-daemon")?.version || ""
}

// device 在线判定: 优先用服务端给的 device.status (空设备也准); 老服务端
// 合成的 device 无 status, 回退到该设备下 runtime 的在线数.
function deviceOnline(group: DeviceGroup): boolean {
    if (group.device.status) return group.device.status === "online"
    return group.onlineCount > 0
}

// 老服务端 (响应无 devices map, 或 runtime.device_id 在 devices 里查不到的
// 脏数据) 时, 从 runtime 自身的 device_info / metadata 合成一个 Device, 保证
// runtime 不会因为缺设备记录而从左树消失. 新服务端正常路径不会走到这里.
function synthDevice(rt: AgentRuntime): Device {
    let info: Record<string, string> = {}
    if (rt.device_info) { try { info = JSON.parse(rt.device_info) } catch {} }
    const meta = parseMetadata(rt.metadata)
    const cli = (meta?.cli_version as string) || ""
    return {
        device_id: rt.device_id || 0,
        device_uuid: info.device_id || "",
        daemon_id: rt.daemon_id || "",
        name: rt.device_name || rt.daemon_id || "unknown",
        os: info.os || "",
        arch: info.arch || "",
        os_version: info.os_version || "",
        status: "",
        last_seen_at: "",
        components: cli ? [{ name: "octo-daemon", version: cli }] : [],
    }
}

// 取 device 下所有 runtime 的 max last_seen_at, 返 epoch ms (无则 0).
// 仅作 device.last_seen_at 缺失时的回退 (老服务端合成 device 无该字段).
// 同 device 的多个 runtime 跑同一 daemon 同一 heartbeatLoop, 各 last_seen_at
// 几乎同步, 取 max 等价 daemon 整体最后心跳时间.
function deviceLastSeenMs(group: DeviceGroup): number {
    let max = 0
    for (const r of group.runtimes) {
        const ts = parseNaiveMs(r.last_seen_at)
        if (ts > max) max = ts
    }
    return max
}

// 以权威 devices map 为准建左树 Level-1: 先按 devices map 落每个设备 (空设备
// 也保留), 再把 runtime 按 device_id 串联挂上去. device_id 查不到对应设备的
// runtime (脏数据 / 老服务端无 devices) 走 synthDevice 兜底, 不丢 runtime.
function groupByDevice(runtimes: AgentRuntime[], devices: Record<string, Device>): DeviceGroup[] {
    const map = new Map<string, DeviceGroup>()
    for (const [key, dev] of Object.entries(devices || {})) {
        map.set(key, { key, device: dev, runtimes: [], onlineCount: 0 })
    }
    for (const rt of runtimes) {
        const key = rt.device_id ? String(rt.device_id) : ""
        let group = key ? map.get(key) : undefined
        if (!group) {
            const fkey = key || rt.daemon_id || "unknown"
            group = map.get(fkey)
            if (!group) {
                group = { key: fkey, device: synthDevice(rt), runtimes: [], onlineCount: 0 }
                map.set(fkey, group)
            }
        }
        group.runtimes.push(rt)
        if (rt.status === "online") group.onlineCount++
    }
    return Array.from(map.values())
}

// ─── DeviceDetail: rendered in RIGHT panel when clicking a device row ───

interface DeviceDetailProps {
    group: DeviceGroup
    daemonVersionHint?: { has_update?: boolean; latest_version?: string; current?: string }
    activeUpgrade?: ActiveUpgrade
    // 升级互斥 UX: 同 RuntimeDetailProps.daemonBusy / onUpgradeStarted.
    daemonBusy?: boolean
    onUpgradeStarted?: () => void
}

interface DeviceDetailState {
    upgradeStatus: "idle" | "pending" | "dispatched" | "downloading" | "installing" | "restarting" | "completed" | "failed" | "timeout"
    upgradeError: string
}

class DeviceDetail extends Component<DeviceDetailProps, DeviceDetailState> {
    private _unmounted = false

    constructor(props: DeviceDetailProps) {
        super(props)
        const upg = props.activeUpgrade
        const initUpgradeStatus = upg ? upg.status as any : "idle"
        const initUpgradeError = upg?.error_msg || ""
        this.state = { upgradeStatus: initUpgradeStatus, upgradeError: initUpgradeError }
    }

    private unsubscribeLocale?: () => void

    componentDidMount() {
        // DeviceDetail 跟
        // RuntimeDetail 893 行同款 remount 续看 — replaceToRoot remount 后
        // 原 handleUpgrade 轮询协程死 (isStale), 新实例若初始 state 是
        // in-progress 必须续看, 否则 upgradeStatus 冻结在 remount 时刻值,
        // 3s 自适应轮询带来的新 prop 也救不了 (此前 componentDidUpdate 只
        // 在 daemonId 变化时重读).
        const upg = this.props.activeUpgrade
        if (upg?.task_id && isUpgradeInProgress(this.state.upgradeStatus)) {
            this.resumeUpgradePoll(upg.task_id)
        }
        // 本面板由 WKApp.routeRight.replaceToRoot 命令式挂载, 不在 I18nProvider
        // 的 React 子树里, 拿不到 useI18n 的 context 刷新. 这里直接订阅 i18n
        // 单例 (等价于 useI18n 做的事), locale 切换时 forceUpdate 重渲染本面板,
        // 否则切语言后当前详情页不变、要切走再回来才更新.
        this.unsubscribeLocale = i18n.subscribe(() => this.forceUpdate())
    }

    componentDidUpdate(prevProps: DeviceDetailProps) {
        if (prevProps.group.device.device_id !== this.props.group.device.device_id) {
            const upg = this.props.activeUpgrade
            const upgStatus = upg ? upg.status as any : "idle"
            const upgError = upg?.error_msg || ""
            this.setState({ upgradeStatus: upgStatus, upgradeError: upgError })
            return
        }
        // 同 daemon 下 activeUpgrade prop 变化 → state 跟进
        // (RuntimeDetail syncUpgradeStateFromProp 同款语义): 页面级轮询
        // (15s/3s) 经 B-4 re-replaceToRoot 推新 prop, React 原地复用实例
        // 时走这里. prop 消失 (任务终态出 active_upgrades) 时若本地还是
        // in-progress 复位 idle — 让 detect 上报后的终态能落地.
        const prevUpg = prevProps.activeUpgrade
        const currUpg = this.props.activeUpgrade
        if (prevUpg?.status === currUpg?.status && prevUpg?.error_msg === currUpg?.error_msg) return
        if (currUpg) {
            this.setState({ upgradeStatus: currUpg.status as any, upgradeError: currUpg.error_msg || "" })
        } else if (isUpgradeInProgress(this.state.upgradeStatus)) {
            this.setState({ upgradeStatus: "idle", upgradeError: "" })
        }
    }

    componentWillUnmount() {
        this._unmounted = true
        this.unsubscribeLocale?.()
    }

    handleUpgrade = async () => {
        this.setState({ upgradeStatus: "pending", upgradeError: "" })
        const daemonId = this.props.group.device.daemon_id
        try {
            const initRes = await WKApp.apiClient.post("/upgrades", { daemon_id: daemonId, space_id: WKApp.shared.currentSpaceId }, { baseURL: fleetApiBase() })
            const taskId = initRes?.data?.task_id
            if (!taskId) throw new Error("upgrade init: missing task_id in response")
            // C-1: task 已创建, 立即让父层重拉 active_upgrades, 其他 detail
            // 的 daemonBusy ~1s 内生效 (不等 15s 轮询).
            this.props.onUpgradeStarted?.()
            await this.resumeUpgradePoll(taskId)
        } catch (err: any) {
            this.setState({ upgradeStatus: "failed", upgradeError: err?.msg || err?.message || t("base.runtimes.upgrade.errFailed") })
        }
    }

    // 轮询已知 taskId 的进度. 抽出复用: 1) handleUpgrade
    // 首次点击; 2) componentDidMount remount 续看 — 跟 RuntimeDetail
    // pollPluginUpgrade/pollComponentUpgrade 同款双入口模式.
    resumeUpgradePoll = async (taskId: string) => {
        const deviceId = this.props.group.device.device_id
        const deviceKey = this.props.group.key
        const isStale = () => this._unmounted || this.props.group.device.device_id !== deviceId
        for (let i = 0; i < 60; i++) {
            if (isStale()) return
            await new Promise(r => setTimeout(r, 2000))
            if (isStale()) return
            let res: any
            try {
                // 单次容错 — 跟 RuntimeDetail pollPluginUpgrade 对齐,
                // 瞬时网络抖动 continue 重试而不是终止整条轮询协程.
                res = (await WKApp.apiClient.get(`/upgrades/${taskId}`, { baseURL: fleetApiBase() }))?.data
            } catch {
                continue
            }
            if (isStale()) return
            if (!res) continue // fleet 空/异常 body → 跳过本次轮询重试, 不在 undefined 上读 .status
            this.setState({ upgradeStatus: res.status })
            if (res.status === "completed") {
                this.setState({ upgradeStatus: "completed" })
                // 方案 3 (升级状态不刷新修复): 原 8s 固定等待砍到 2s —
                // 后面的确认循环本身已有 2s×10 重试, 足够覆盖 daemon
                // detect 上报延迟, 固定 8s 只是让 UI 终态白等.
                await new Promise(r => setTimeout(r, 2000))
                if (isStale()) return
                for (let j = 0; j < 10; j++) {
                    if (isStale()) return
                    await new Promise(r => setTimeout(r, 2000))
                    if (isStale()) return
                    try {
                        const runtimesRes = (await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId }, baseURL: fleetApiBase() }))?.data
                        if (isStale()) return
                        const hints = runtimesRes?.daemon_version_hints || {}
                        if (!hints[deviceKey]?.has_update) {
                            const allRuntimes = runtimesRes?.runtimes || []
                            const devices = runtimesRes?.devices || {}
                            const groups = groupByDevice(allRuntimes, devices)
                            const updated = groups.find((g: DeviceGroup) => g.key === deviceKey)
                            if (updated) {
                                // B-5 (X3): 自我重渲染同样透传 daemonBusy /
                                // onUpgradeStarted, 否则这条路径 remount 的
                                // detail 丢互斥 props. 注: 此刻本 daemon 升级
                                // 刚完成, busy 取自己 props 当前值 (15s 轮询
                                // 链路会在下轮带来准确值).
                                WKApp.routeRight.replaceToRoot(
                                    <DeviceDetail
                                        group={updated}
                                        daemonVersionHint={hints[deviceKey]}
                                        daemonBusy={this.props.daemonBusy}
                                        onUpgradeStarted={this.props.onUpgradeStarted}
                                    />
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
        this.setState({ upgradeStatus: "timeout", upgradeError: t("base.runtimes.upgrade.errPollingTimeout") })
    }

    render() {
        const { group } = this.props
        const device = group.device
        const online = deviceOnline(group)
        const allRuntimesOnline = group.onlineCount === group.runtimes.length && group.runtimes.length > 0
        const cliVersion = daemonVersion(device)
        const osText = [osLabel(device.os), device.arch].filter(Boolean).join(" ")
        const isWindows = device.os === "windows"

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
                        <h2>{device.name}</h2>
                    </div>
                    <span className={`wk-rt-status-badge ${online ? "online" : "offline"}`}>
                        {group.runtimes.length > 0
                            ? (allRuntimesOnline ? t("base.runtimes.device.allOnline") : online ? t("base.runtimes.createBot.onlineCount", { values: { online: group.onlineCount, total: group.runtimes.length } }) : t("base.runtimes.common.offline"))
                            : (online ? t("base.runtimes.device.online") : t("base.runtimes.common.offline"))}
                    </span>
                </div>

                <div className="wk-rt-detail-grid">
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.device.name")}</label>
                        <span>{device.name}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.device.runtimes")}</label>
                        <span>{group.runtimes.length}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.device.mode")}</label>
                        <span>{deviceRuntimeMode(group)}</span>
                    </div>
                    {osText && (
                        <div className="wk-rt-field">
                            <label>{t("base.runtimes.device.osArch")}</label>
                            <span>{osText}</span>
                        </div>
                    )}
                    {device.os_version && (
                        <div className="wk-rt-field">
                            <label>{t("base.runtimes.device.osVersion")}</label>
                            <span className="wk-rt-mono">{device.os_version}</span>
                        </div>
                    )}
                    {cliVersion && (
                        <div className="wk-rt-field">
                            <label>{t("base.runtimes.device.daemonVersion")}</label>
                            <span className="wk-rt-mono">
                                {cliVersion}
                                {this.props.daemonVersionHint?.has_update && (
                                    <span className="wk-rt-update-hint"> → {this.props.daemonVersionHint.latest_version}</span>
                                )}
                                {this.props.daemonVersionHint?.has_update && (() => {
                                    const { upgradeStatus, upgradeError } = this.state
                                    const inProgress = isUpgradeInProgress(upgradeStatus)
                                    // busy 且不是自己在升级 → 其他升级在跑, fleet 会拒
                                    const busyByOther = !!this.props.daemonBusy && !inProgress

                                    if (upgradeStatus === "completed") {
                                        return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />{t("base.runtimes.upgrade.upgraded")}</span>
                                    }
                                    if (upgradeStatus === "failed" || upgradeStatus === "timeout") {
                                        // A-1: error_msg 内联展示 (原来藏 hover title 像升级真坏了);
                                        // A-2: 旁挂 Retry, busy 时禁用 (P7/X6 — 互斥拒后 daemon
                                        // 仍忙, Retry 可点必再撞墙).
                                        return (
                                            <span className="wk-rt-upgrade-status error" title={upgradeError}>
                                                <span className="upgrade-dot" />
                                                {upgradeStatus === "timeout" ? t("base.runtimes.upgrade.timeout") : t("base.runtimes.upgrade.failed")}
                                                {upgradeError && <span className="wk-rt-upgrade-reason">· {upgradeError.length > 40 ? upgradeError.slice(0, 40) + "…" : upgradeError}</span>}
                                                {!isWindows && (busyByOther
                                                    ? <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{t("base.runtimes.upgrade.upgrade")}</span>
                                                    : <span className="wk-rt-upgrade-btn" onClick={this.handleUpgrade}>{t("base.runtimes.upgrade.upgrade")}</span>)}
                                            </span>
                                        )
                                    }
                                    if (inProgress) {
                                        return <span className="wk-rt-upgrade-status progress"><span className="upgrade-dot" />{upgradeStageLabel(upgradeStatus)}…</span>
                                    }
                                    if (isWindows) {
                                        return <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.windowsUnsupported")}>{t("base.runtimes.upgrade.upgrade")}</span>
                                    }
                                    if (busyByOther) {
                                        // B-3: 同 daemon 其他升级在跑, 点了 fleet 必拒 — 预防性禁用
                                        return <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{t("base.runtimes.upgrade.upgrade")}</span>
                                    }
                                    if (!online) return null
                                    return <span className="wk-rt-upgrade-btn" onClick={this.handleUpgrade}>{t("base.runtimes.upgrade.upgrade")}</span>
                                })()}
                            </span>
                        </div>
                    )}
                    {device.device_uuid && (
                        <div className="wk-rt-field">
                            <label>{t("base.runtimes.device.id")}</label>
                            <span className="wk-rt-mono">{device.device_uuid}</span>
                        </div>
                    )}
                    {(() => {
                        // 最近活跃: 优先用 device.last_seen_at (服务端权威), 缺失时
                        // (老服务端合成 device) 回退到该 device 下 runtime 的 max
                        // last_seen_at. title 走本地时区 (toLocaleString).
                        const ms = parseNaiveMs(device.last_seen_at) || deviceLastSeenMs(group)
                        if (!ms) return null
                        return (
                            <div className="wk-rt-field">
                                <label>{t("base.runtimes.device.lastActive")}</label>
                                <span title={new Date(ms).toLocaleString()}>
                                    {humanizeAge(ms)}
                                </span>
                            </div>
                        )
                    })()}
                </div>

                {/* 核心组件 (device.components 的 name+version) 暂隐藏 — 可操作的
                    Daemon 版本已在上方字段网格展示, 其余 SDK 版本号仅诊断用, 日常
                    价值低. Device.components 类型/解析保留, 以后要排障面板再恢复. */}
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
        Toast.warning({ content: t("base.runtimes.common.clipboardUnsupported"), duration: 2 })
        return
    }
    p.then(
        () => Toast.success({ content: t("base.runtimes.common.copied", { values: { text: mention } }), duration: 2 }),
        () => Toast.warning({ content: t("base.runtimes.common.copyFailed"), duration: 2 }),
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
                    title={t("base.runtimes.botDetail.openDM")}
                    onClick={openChat}
                >
                    <WKAvatar channel={channel} style={{ width: 32, height: 32, borderRadius: "50%" }} />
                    {route.online && <span className="wk-rt-online-dot" title={t("base.runtimes.common.online")} />}
                </div>
                <div className="wk-rt-binding-text">
                    <span
                        className="wk-rt-binding-primary wk-rt-clickable"
                        title={t("base.runtimes.botDetail.openDM")}
                        onClick={openChat}
                    >
                        {displayName}
                    </span>
                    {showSecondary && (
                        <span
                            className="wk-rt-binding-mention"
                            title={t("base.runtimes.botDetail.copyMention")}
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
                title={t("base.runtimes.botDetail.copyMention")}
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

    // TODO(fleet-api): the managed-agents endpoints (/runtimes/managed-agents*,
    // /runtimes/{id}/agents/.../bots) no longer exist on fleet — bot creation
    // moved to botsApi.createBot (POST /v1/bots + mint). This whole modal path
    // is dead against the current fleet API; migrate it to botsApi or remove.
    // Left intact here to avoid a UI-flow rewrite outside the API-sync scope.
    private pollManagedAgent = async (id: number): Promise<ManagedAgent> => {
        const deadline = Date.now() + 60_000
        for (;;) {
            const ma: ManagedAgent = await WKApp.apiClient.get(`/runtimes/managed-agents/${id}`)
            if (ma.status === "active" || ma.status === "failed") return ma
            if (Date.now() > deadline) {
                return { ...ma, status: "failed", error_msg: t("base.runtimes.agentModal.errDaemonTimeout") }
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
                Toast.info(t("base.runtimes.agentModal.toastRegistered"))
            } else {
                // add-bot
                if (!modalAgentId) return
                created = await WKApp.apiClient.post(
                    `/runtimes/${runtime.id}/agents/${encodeURIComponent(modalAgentId)}/bots`,
                    { display_name: values.display_name },
                )
                Toast.info(t("base.runtimes.agentModal.toastMinted", { values: { bot: created.bot_uid, agent: modalAgentId } }))
            }
            const final = await this.pollManagedAgent(created.id)
            if (final.status === "active") {
                Toast.success(
                    modalMode === "create-agent"
                        ? t("base.runtimes.agentModal.toastAgentCreated", { values: { agent: final.agent_id } })
                        : t("base.runtimes.agentModal.toastBotBound", { values: { bot: final.display_name, agent: final.agent_id } })
                )
            } else {
                Toast.error(t("base.runtimes.common.opFailed", { values: { error: final.error_msg || t("base.runtimes.common.unknownError") } }))
            }
            this.setState({ modalMode: null, modalAgentId: null, submitting: false })
            // Daemon force-syncs server metadata before ack, so a single
            // refresh right after "active" is sufficient.
            this.props.onChanged?.()
        } catch (err: any) {
            console.error("managed agent op failed", err)
            const msg = err?.msg || err?.message || String(err)
            Toast.error(t("base.runtimes.common.opFailed", { values: { error: msg } }))
            this.setState({ submitting: false })
        }
    }

    private renderModal() {
        const { modalMode, modalAgentId, submitting } = this.state
        if (!modalMode) return null
        const isAddBot = modalMode === "add-bot"
        return (
            <Modal
                title={isAddBot ? t("base.runtimes.agentModal.titleAddBot", { values: { agent: modalAgentId } }) : t("base.runtimes.agentModal.titleCreateAgent")}
                visible
                onCancel={this.closeModal}
                footer={null}
                maskClosable={!submitting}
                width={420}
            >
                <Form onSubmit={this.submitForm}>
                    <Form.Input
                        field="display_name"
                        label={isAddBot ? t("base.runtimes.agentModal.labelBotName") : t("base.runtimes.agentModal.labelAgentName")}
                        placeholder={isAddBot ? t("base.runtimes.agentModal.placeholderBot") : t("base.runtimes.agentModal.placeholderAgent")}
                        rules={[
                            { required: true, message: t("base.runtimes.agentModal.required") },
                            { max: 60, message: t("base.runtimes.agentModal.maxChars") },
                        ]}
                        disabled={submitting}
                    />
                    <div className="wk-rt-modal-footer">
                        <Button onClick={this.closeModal} disabled={submitting}>{t("base.runtimes.common.cancel")}</Button>
                        <Button type="primary" theme="solid" htmlType="submit" loading={submitting}>
                            {isAddBot ? t("base.runtimes.agentModal.submitAddBot") : t("base.runtimes.agentModal.submitCreateAgent")}
                        </Button>
                    </div>
                </Form>
                <div className="wk-rt-modal-hint">
                    {isAddBot
                        ? t("base.runtimes.agentModal.hintAddBot", { values: { agent: modalAgentId } })
                        : t("base.runtimes.agentModal.hintCreateAgent")}
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
                    <span className="wk-rt-managed-title">{t("base.runtimes.agents.title")}</span>
                    <span className="wk-rt-managed-count">{agents.length}</span>
                    {agents.length > 0 && (
                        <button
                            type="button"
                            className="wk-rt-managed-toggle-all"
                            onClick={this.toggleAll}
                            title={allExpanded ? t("base.runtimes.create.collapseAll") : t("base.runtimes.create.expandAll")}
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
                            <span>{allExpanded ? t("base.runtimes.create.collapseAll") : t("base.runtimes.create.expandAll")}</span>
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
                            <span>{t("base.runtimes.agents.newAgent")}</span>
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
                        <div className="wk-rt-managed-empty-text">{t("base.runtimes.agents.noAgents")}</div>
                        {manageable && (
                            <div className="wk-rt-managed-empty-hint">{t("base.runtimes.create.createFirst")}</div>
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
                                                {agent.is_default && <span className="wk-rt-default-tag">{t("base.runtimes.agents.defaultTag")}</span>}
                                            </div>
                                            <div className="wk-rt-managed-agent-meta">
                                                {t("base.runtimes.agents.botCount", { values: { count: routeInfos.length } })}
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
                                                <div className="wk-rt-managed-no-bots">{t("base.runtimes.agents.noBotsBound")}</div>
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
                                                    <span>{t("base.runtimes.agents.addBot")}</span>
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

// ─── BotsSection 已删 (PR-2):
//     左树 Level-3 (BotRow) 已显示该 runtime 的 bot 列表 + 顶部 + popover
//     提供"创建 Bot" 入口, 这一段嵌入式 BotsSection 完全 dead code.
// ────────────────────────────────────────────────────────────────────────

// ─── RuntimeDetail: rendered in RIGHT panel when clicking an agent ──────

interface RuntimeDetailProps {
    runtime: AgentRuntime
    versionHints: Record<number, { has_update?: boolean; latest_version?: string; has_plugin_update?: boolean; plugin_latest_version?: string; plugin_install_version?: string }>
    pluginActiveUpgrade?: ActiveUpgrade
    componentActiveUpgrade?: ActiveUpgrade
    onDelete: (id: number) => void
    onAgentsChanged?: () => void
    // 升级互斥 UX (plan-upgrade-mutex-ux §2.B): 该 runtime 所属 daemon 是否
    // 有任一 in-progress 升级 task (无论 component). fleet insertUpgradeTask
    // 同 daemon 互斥 (upgrade.go:359), busy 时其他 Upgrade 按钮必失败 —
    // 禁用 + title 预防, 替代点了才报错.
    daemonBusy?: boolean
    // §2.C: POST /runtimes/upgrade 成功后通知父层立即 silent loadData,
    // 让其他已打开 detail 的 daemonBusy 在 ~1s 内更新 (不等 15s 轮询).
    onUpgradeStarted?: () => void
    // RuntimeDetail 详情页信息密度
    // 低 (只 Runtime Mode / Provider / Version / Octo Plugin). 父侧
    // RuntimesPage 持有 botsByRuntime cache, 把"已绑定 Bot 数" prop 注入
    // 让 detail 页有 runtime-级别的真实信息 (跟 last_seen_at 那种 daemon-
    // 级别冗余的不同).
    botCount?: number
    // Open the cc install modal for this runtime. The modal lives at PAGE level
    // (not in this pane) so an entered gateway/key/model survives the detail
    // pane's 15s-poll re-push / remount — see RuntimesPage.ccInstallTarget.
    onCcInstallOpen?: (rt: AgentRuntime) => void
    // A one-shot cc install request handed down from the page after the modal is
    // submitted. The detail runs it through handlePluginUpgrade (which POLLS the
    // task and surfaces failed/timeout), so the install shares the exact same
    // lifecycle as the Upgrade button — terminal errors stay visible instead of
    // being POSTed-and-forgotten. `token` makes it idempotent across re-pushes;
    // the detail calls onCcInstallConsumed once it has started the request so the
    // page clears it (page-level dedup survives a detail remount).
    pendingCcInstall?: { token: number; runtimeId: number; component: string; secret: { gatewayUrl: string; apiKey: string; model?: string } }
    onCcInstallConsumed?: (token: number) => void
}

type PluginUpgradeStatus = "idle" | "pending" | "dispatched" | "downloading" | "installing" | "restarting" | "completed" | "failed" | "timeout"

// Single source for the plugin upgrade/install POST. Both the detail pane's
// Upgrade button and the page-level cc install modal go through here, so the
// install flow never re-grows a divergent copy of the upgrade pipeline.
// Returns the task id; throws on a missing/failed response.
async function postPluginUpgrade(
    rt: AgentRuntime,
    pluginComponent: string,
    secret?: { gatewayUrl: string; apiKey: string; model?: string },
): Promise<string> {
    const initRes = await WKApp.apiClient.post("/upgrades", {
        runtime_id: rt.id,
        daemon_id: rt.daemon_id,
        space_id: WKApp.shared.currentSpaceId,
        component: pluginComponent,
        ...(secret ? { gateway_url: secret.gatewayUrl, api_key: secret.apiKey, ...(secret.model ? { model: secret.model } : {}) } : {}),
    }, { baseURL: fleetApiBase() })
    const taskId = initRes?.data?.task_id
    if (!taskId) throw new Error("plugin upgrade init: missing task_id in response")
    return taskId
}

// in-progress 状态全集 — 必须跟 fleet upgrade.go:401 互斥判定集合严格一致
// (5 态). web 早期只枚举 pending/dispatched/installing 三态, 漏 downloading/
// restarting — daemon 升级走 downloading→installing→restarting, 漏态期间
// busyDaemons 误判不忙 (plan-upgrade-mutex-ux P2).
const UPGRADE_IN_PROGRESS_STATUSES = new Set<string>([
    "pending", "dispatched", "downloading", "installing", "restarting",
])

function isUpgradeInProgress(status: string): boolean {
    return UPGRADE_IN_PROGRESS_STATUSES.has(status)
}

// 升级 in-progress 阶段的展示文案 (单源, 3 处升级按钮共用). 英文 — 跟
// detail 面板 label 一致. daemon 逐阶段上报 (downloading→installing→
// restarting), 自适应轮询 3s 拉到变化, 这里把原始 status 映射成可读阶段
// 让用户看到"在动、在哪一步", 而非一个静态 installing. 终态
// (completed/failed/timeout) 由各 renderer 自己处理, 不走这里.
// ⚠️ 新增 in-progress 状态时同步 UPGRADE_IN_PROGRESS_STATUSES + 这里,
// 否则漏的态走 default 显示原始 snake_case (不崩, 但用户看着别扭).
function upgradeStageLabel(status: string): string {
    switch (status) {
        case "pending":
        case "dispatched":  return t("base.runtimes.upgrade.stageQueued")
        case "downloading": return t("base.runtimes.upgrade.stageDownloading")
        case "installing":  return t("base.runtimes.upgrade.stageInstalling")
        case "restarting":  return t("base.runtimes.upgrade.stageRestarting")
        default:            return status
    }
}

// 页面级轮询两档间隔: 空闲 15s; 有 in-progress 升级任务时 3s (升级状态
// 不刷新修复方案 2 — 详见 RuntimesPage.adjustPollInterval 注释).
const POLL_IDLE_MS = 15000
const POLL_UPGRADE_MS = 3000

// 允许远程升级的 provider（和服务端 providerComponents / daemon componentUpgradeSpecs 保持一致）
const COMPONENT_UPGRADE_ENABLED = new Set<string>(["claude", "openclaw"])

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

    private unsubscribeLocale?: () => void

    componentDidMount() {
        // WKApp.routeRight.replaceToRoot 有时真的会 unmount + remount 组件，
        // 此时原 handlePluginUpgrade 里的轮询协程 isStale() 退出，
        // 新实例若初始 state 是 in-progress，必须主动"续看轮询"，否则 state
        // 停留在 installing/dispatched 永不更新，用户要切页面才能跳出。
        const { pluginUpgradeStatus, componentUpgradeStatus } = this.state
        const pluginUpg = this.props.pluginActiveUpgrade
        if (pluginUpg?.task_id && isUpgradeInProgress(pluginUpgradeStatus)) {
            // remount 续看时必须重建 install 上下文 —— 否则 install 在途也会落回升级的
            // !has_plugin_update 完成条件,首装时它一开始即 true 会过早 remount + 「安装」
            // 按钮闪回(与点击路径同一竞态)。在途插件还没出现在 metadata.plugins 即视为 install。
            const isInstall = !octoPluginInstalled(this.props.runtime.metadata, pluginUpg.component)
            this.pollPluginUpgrade(pluginUpg.task_id, this.props.runtime.id, { component: pluginUpg.component, isInstall })
        }
        const compUpg = this.props.componentActiveUpgrade
        if (compUpg?.task_id && isUpgradeInProgress(componentUpgradeStatus)) {
            this.pollComponentUpgrade(compUpg.task_id, this.props.runtime.id)
        }
        // 同 DeviceDetail: 本面板由 routeRight.replaceToRoot 命令式挂载, 不在
        // I18nProvider 子树里, 订阅 i18n 单例 + forceUpdate 让切语言后实时刷新.
        this.unsubscribeLocale = i18n.subscribe(() => this.forceUpdate())
        // 一个已挂起的 cc 安装请求(从 page 的 modal 提交下来)可能在本实例挂载时
        // 就在 props 里(尤其 remount 续看场景),立即消费。
        this.maybeRunPendingCcInstall()
    }

    // Consume a one-shot cc install handed down from the page. Runs it through
    // handlePluginUpgrade so the install POLLS its task and surfaces failed/
    // timeout — the same lifecycle as the Upgrade button. Idempotent on token so
    // a detail re-push can't fire the install twice; the page clears the request
    // after onCcInstallConsumed.
    private lastConsumedCcInstallToken?: number
    private maybeRunPendingCcInstall() {
        const req = this.props.pendingCcInstall
        if (!req) return
        if (req.runtimeId !== this.props.runtime.id) return // not for this runtime
        if (this.lastConsumedCcInstallToken === req.token) return // already started
        this.lastConsumedCcInstallToken = req.token
        this.props.onCcInstallConsumed?.(req.token)
        void this.handlePluginUpgrade(req.component, true, req.secret)
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
            }, () => {
                // A pending cc install for the NEW runtime (the page re-pushed this
                // same instance with a different runtime + pendingCcInstall) must
                // still be consumed — run it after the reset state lands so its
                // pending/dispatched status isn't clobbered by the reset above.
                this.maybeRunPendingCcInstall()
            })
            return
        }

        // A cc install request handed down from the page (modal submit) runs here
        // through the polled handlePluginUpgrade lifecycle.
        this.maybeRunPendingCcInstall()

        // Install-completion via metadata: when the target plugin transitions from
        // absent → present in the runtime metadata, the install has landed. By then
        // the task has usually dropped out of active_upgrades, so the prop-sync below
        // (which only reacts to activeUpgrade changes) never fires — a metadata-only
        // refresh would otherwise leave the reused instance pinned at "installing".
        // Clear it here. Gated on:
        //   - the absent→present transition, so an UPGRADE (plugin present throughout)
        //     is never cleared prematurely;
        //   - the active-upgrade prop being gone, so we don't fight a still-tracked task;
        //   - the status being an IN-PROGRESS one — a terminal failed/timeout must NOT
        //     be wiped to idle (a cc install can land the plugin binary in metadata yet
        //     still fail the configure/key step; that error must stay visible).
        const comp = octoComponentName(this.props.runtime.provider)
        if (
            comp &&
            !this.props.pluginActiveUpgrade &&
            isUpgradeInProgress(this.state.pluginUpgradeStatus) &&
            !octoPluginInstalled(prevProps.runtime.metadata, comp) &&
            octoPluginInstalled(this.props.runtime.metadata, comp)
        ) {
            this.setState({ pluginUpgradeStatus: "idle", pluginUpgradeError: "" })
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
        this.unsubscribeLocale?.()
    }

    handleDelete = async () => {
        if (!window.confirm(t("base.runtimes.runtime.deleteConfirm"))) return
        this.setState({ deleting: true })
        try {
            await WKApp.apiClient.delete(`/runtimes/${this.props.runtime.id}`, { baseURL: fleetApiBase() })
            this.props.onDelete(this.props.runtime.id)
        } catch {
            this.setState({ deleting: false })
        }
    }

    handlePluginUpgrade = async (pluginComponent: string, isInstall = false, secret?: { gatewayUrl: string; apiKey: string; model?: string }) => {
        const rt = this.props.runtime
        const runtimeId = rt.id

        this.setState({ pluginUpgradeStatus: "pending", pluginUpgradeError: "" })
        try {
            const taskId = await postPluginUpgrade(rt, pluginComponent, secret)
            // 立即让父层重拉 active_upgrades (见 RuntimeDetailProps 注释)
            this.props.onUpgradeStarted?.()
            await this.pollPluginUpgrade(taskId, runtimeId, { component: pluginComponent, isInstall })
        } catch (err: any) {
            const msg = err?.msg || err?.message || t("base.runtimes.upgrade.errFailed")
            this.setState({ pluginUpgradeStatus: "failed", pluginUpgradeError: msg })
        }
    }

    // 轮询已知 taskId 的进度。抽出复用于：1）首次点击 Upgrade / Install；2）remount 后续看。
    // opts.isInstall: 首装走专属完成条件(等插件出现在 metadata.plugins),升级仍用
    // !has_plugin_update —— 否则首装时该 hint 一开始即 false 会让确认循环过早 remount。
    pollPluginUpgrade = async (taskId: string, runtimeId: number, opts?: { component?: string; isInstall?: boolean }) => {
        const isStale = () => this._unmounted || this.props.runtime.id !== runtimeId
        for (let i = 0; i < 200; i++) {
            if (isStale()) return
            await new Promise(r => setTimeout(r, 3000))
            if (isStale()) return
            let res: any
            try {
                res = (await WKApp.apiClient.get(`/upgrades/${taskId}`, { baseURL: fleetApiBase() }))?.data
            } catch {
                continue
            }
            if (isStale()) return
            if (!res) continue // fleet 空/异常 body → 跳过本次轮询重试, 不在 undefined 上读 .status
            this.setState({ pluginUpgradeStatus: res.status, pluginUpgradeError: res.error_msg || "" })
            if (res.status === "completed") {
                // 方案 3 (升级状态不刷新修复): 原 8s 固定等待砍到 2s — 后面的确认
                // 循环本身已有 2s×10 重试, 足够覆盖 daemon detect 上报延迟,
                // 固定 8s 只是让 UI 终态白等.
                await new Promise(r => setTimeout(r, 2000))
                if (isStale()) return
                for (let j = 0; j < 10; j++) {
                    if (isStale()) return
                    await new Promise(r => setTimeout(r, 2000))
                    if (isStale()) return
                    try {
                        const runtimesRes = (await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId }, baseURL: fleetApiBase() }))?.data
                        if (isStale()) return
                        const hints = runtimesRes?.version_hints || {}
                        const allRuntimes = runtimesRes?.runtimes || []
                        const updated = allRuntimes.find((r: AgentRuntime) => r.id === runtimeId)
                        // install: 等插件真正出现在 metadata.plugins;upgrade: 等 has_plugin_update 翻 false。
                        const landed = opts?.isInstall
                            ? octoPluginInstalled(updated?.metadata, opts.component)
                            : !hints[runtimeId]?.has_plugin_update
                        if (landed) {
                            if (updated) {
                                // 透传互斥 props, 同 DeviceDetail 注释。
                                // 完成后清掉本插件的在途 prop —— 不再把旧的 in-progress
                                // (installing/…) 透传给复用实例, 否则 syncUpgradeStateFromProp
                                // 会把刚落地的状态重新注入回"安装中/升级中"。
                                WKApp.routeRight.replaceToRoot(
                                    <RuntimeDetail
                                        runtime={updated}
                                        versionHints={hints}
                                        pluginActiveUpgrade={undefined}
                                        componentActiveUpgrade={this.props.componentActiveUpgrade}
                                        onDelete={this.props.onDelete}
                                        botCount={this.props.botCount}
                                        daemonBusy={this.props.daemonBusy}
                                        onUpgradeStarted={this.props.onUpgradeStarted}
                                        onCcInstallOpen={this.props.onCcInstallOpen}
                                        pendingCcInstall={this.props.pendingCcInstall}
                                        onCcInstallConsumed={this.props.onCcInstallConsumed}
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
        this.setState({ pluginUpgradeStatus: "timeout", pluginUpgradeError: t("base.runtimes.upgrade.errPollingTimeout") })
    }

    renderPluginUpgradeBtn(pluginName: string, hasUpdate: boolean | undefined, action: "upgrade" | "install" = "upgrade", onInstallClick?: () => void) {
        const { pluginUpgradeStatus, pluginUpgradeError } = this.state
        // busy 来源是否本按钮自己的 task — 自己升级显示进度态; 别的 task
        // 在跑则本按钮 busy-disabled (按钮粒度豁免).
        const selfInProgress = isUpgradeInProgress(pluginUpgradeStatus)
        const busyByOther = !!this.props.daemonBusy && !selfInProgress
        // install: 用「安装」文案、空闲即显按钮; upgrade: 用「升级」文案、仅有更新时显。
        const actionLabel = action === "install" ? t("base.runtimes.upgrade.install") : t("base.runtimes.upgrade.upgrade")
        if (pluginUpgradeStatus === "completed") {
            return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />{t("base.runtimes.upgrade.completed")}</span>
        }
        if (pluginUpgradeStatus === "failed" || pluginUpgradeStatus === "timeout") {
            // A-1 错误内联 + A-2 Retry (busy 时禁用 — P7/X6)
            return (
                <span className="wk-rt-upgrade-status error" title={pluginUpgradeError}>
                    <span className="upgrade-dot" />
                    {pluginUpgradeStatus === "timeout" ? t("base.runtimes.upgrade.timeout") : t("base.runtimes.upgrade.failed")}
                    {pluginUpgradeError && <span className="wk-rt-upgrade-reason">· {pluginUpgradeError.length > 40 ? pluginUpgradeError.slice(0, 40) + "…" : pluginUpgradeError}</span>}
                    {!!pluginName && (busyByOther
                        ? <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{actionLabel}</span>
                        : <span className="wk-rt-upgrade-btn" onClick={() => onInstallClick ? onInstallClick() : this.handlePluginUpgrade(pluginName, action === "install")}>{actionLabel}</span>)}
                </span>
            )
        }
        if (pluginUpgradeStatus !== "idle") {
            // For install, collapse the granular stages (queued/downloading/…) into a
            // single "Installing" — "Queued" confuses users for a one-click install.
            const stageText = action === "install"
                ? t("base.runtimes.upgrade.stageInstalling")
                : upgradeStageLabel(pluginUpgradeStatus)
            return (
                <span className="wk-rt-upgrade-status progress">
                    <span className="upgrade-dot" />
                    {stageText}…
                </span>
            )
        }
        const showIdle = action === "install" ? !!pluginName : (hasUpdate && !!pluginName)
        if (showIdle) {
            if (busyByOther) {
                // 同 daemon 其他升级在跑, fleet 必拒 — 预防性禁用
                return <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{actionLabel}</span>
            }
            return <span className="wk-rt-upgrade-btn" onClick={() => onInstallClick ? onInstallClick() : this.handlePluginUpgrade(pluginName, action === "install")}>{actionLabel}</span>
        }
        return null
    }

    // ── Component 升级（claude/openclaw） ──────────────────────

    handleComponentUpgrade = async () => {
        const rt = this.props.runtime
        const runtimeId = rt.id
        const component = rt.provider

        this.setState({ componentUpgradeStatus: "pending", componentUpgradeError: "" })
        try {
            const initRes = await WKApp.apiClient.post("/upgrades", {
                runtime_id: runtimeId,
                daemon_id: rt.daemon_id,
                space_id: WKApp.shared.currentSpaceId,
                component,
            }, { baseURL: fleetApiBase() })
            // 立即让父层重拉 active_upgrades (见 RuntimeDetailProps 注释)
            this.props.onUpgradeStarted?.()
            const taskId = initRes?.data?.task_id
            if (!taskId) throw new Error("component upgrade init: missing task_id in response")
            await this.pollComponentUpgrade(taskId, runtimeId)
        } catch (err: any) {
            const msg = err?.msg || err?.message || t("base.runtimes.upgrade.errFailed")
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
                res = (await WKApp.apiClient.get(`/upgrades/${taskId}`, { baseURL: fleetApiBase() }))?.data
            } catch {
                continue
            }
            if (isStale()) return
            if (!res) continue // fleet 空/异常 body → 跳过本次轮询重试, 不在 undefined 上读 .status
            this.setState({ componentUpgradeStatus: res.status, componentUpgradeError: res.error_msg || "" })
            if (res.status === "completed") {
                // 服务端关单（register 匹配新版本）后再刷一次 runtimes 拿最新 version_hints
                // 方案 3 (升级状态不刷新修复): 原 8s 固定等待砍到 2s — 后面的确认
                // 循环本身已有 2s×10 重试, 足够覆盖 daemon detect 上报延迟,
                // 固定 8s 只是让 UI 终态白等.
                await new Promise(r => setTimeout(r, 2000))
                if (isStale()) return
                for (let j = 0; j < 10; j++) {
                    if (isStale()) return
                    await new Promise(r => setTimeout(r, 2000))
                    if (isStale()) return
                    try {
                        const runtimesRes = (await WKApp.apiClient.get("/runtimes", { param: { space_id: WKApp.shared.currentSpaceId }, baseURL: fleetApiBase() }))?.data
                        if (isStale()) return
                        const hints = runtimesRes?.version_hints || {}
                        if (!hints[runtimeId]?.has_update) {
                            const allRuntimes = runtimesRes?.runtimes || []
                            const updated = allRuntimes.find((r: AgentRuntime) => r.id === runtimeId)
                            if (updated) {
                                // B-5 (X3): 透传互斥 props, 同 DeviceDetail 注释
                                WKApp.routeRight.replaceToRoot(
                                    <RuntimeDetail
                                        runtime={updated}
                                        versionHints={hints}
                                        pluginActiveUpgrade={this.props.pluginActiveUpgrade}
                                        componentActiveUpgrade={this.props.componentActiveUpgrade}
                                        onDelete={this.props.onDelete}
                                        botCount={this.props.botCount}
                                        daemonBusy={this.props.daemonBusy}
                                        onUpgradeStarted={this.props.onUpgradeStarted}
                                        onCcInstallOpen={this.props.onCcInstallOpen}
                                        pendingCcInstall={this.props.pendingCcInstall}
                                        onCcInstallConsumed={this.props.onCcInstallConsumed}
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
        this.setState({ componentUpgradeStatus: "timeout", componentUpgradeError: t("base.runtimes.upgrade.errPollingTimeout") })
    }

    renderComponentUpgradeBtn(hasUpdate: boolean | undefined) {
        const rt = this.props.runtime
        if (!COMPONENT_UPGRADE_ENABLED.has(rt.provider)) return null

        const { componentUpgradeStatus, componentUpgradeError } = this.state
        // 同 renderPluginUpgradeBtn: 按钮粒度豁免 (plan §2.B-3 / X4)
        const selfInProgress = isUpgradeInProgress(componentUpgradeStatus)
        const busyByOther = !!this.props.daemonBusy && !selfInProgress
        if (componentUpgradeStatus === "completed") {
            return <span className="wk-rt-upgrade-status success"><span className="upgrade-dot" />{t("base.runtimes.upgrade.completed")}</span>
        }
        if (componentUpgradeStatus === "failed" || componentUpgradeStatus === "timeout") {
            // A-1 错误内联 + A-2 Retry (busy 时禁用 — P7/X6)
            return (
                <span className="wk-rt-upgrade-status error" title={componentUpgradeError}>
                    <span className="upgrade-dot" />
                    {componentUpgradeStatus === "timeout" ? t("base.runtimes.upgrade.timeout") : t("base.runtimes.upgrade.failed")}
                    {componentUpgradeError && <span className="wk-rt-upgrade-reason">· {componentUpgradeError.length > 40 ? componentUpgradeError.slice(0, 40) + "…" : componentUpgradeError}</span>}
                    {busyByOther
                        ? <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{t("base.runtimes.upgrade.upgrade")}</span>
                        : <span className="wk-rt-upgrade-btn" onClick={this.handleComponentUpgrade}>{t("base.runtimes.upgrade.upgrade")}</span>}
                </span>
            )
        }
        if (componentUpgradeStatus !== "idle") {
            return (
                <span className="wk-rt-upgrade-status progress">
                    <span className="upgrade-dot" />
                    {upgradeStageLabel(componentUpgradeStatus)}…
                </span>
            )
        }
        if (hasUpdate) {
            if (busyByOther) {
                // 同 daemon 其他升级在跑, fleet 必拒 — 预防性禁用
                return <span className="wk-rt-upgrade-btn disabled" title={t("base.runtimes.upgrade.busyTitle")}>{t("base.runtimes.upgrade.upgrade")}</span>
            }
            return <span className="wk-rt-upgrade-btn" onClick={this.handleComponentUpgrade}>{t("base.runtimes.upgrade.upgrade")}</span>
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
                    <div className="wk-rt-provider-icon large">
                        <ProviderLogo provider={rt.provider} className="wk-rt-provider-mark" />
                    </div>
                    <div className="wk-rt-detail-title">
                        <h2>{rt.name}</h2>
                    </div>
                    <div className="wk-rt-detail-actions">
                        <span className={`wk-rt-status-badge ${isOnline ? "online" : "offline"}`}>
                            {isOnline ? t("base.runtimes.common.online") : t("base.runtimes.common.offline")}
                        </span>
                    </div>
                </div>

                <div className="wk-rt-detail-grid wk-rt-detail-grid--single">
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.runtime.provider")}</label>
                        <span>{providerLabels[rt.provider] || rt.provider}</span>
                    </div>
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.runtime.botCount")}</label>
                        <span>{this.props.botCount ?? 0}</span>
                    </div>
                    {/* PR-2: 探活由 device row 绿点 + daemon heartbeat
                        体现; runtime 级 last_seen_at / device_name /
                        daemon_id 都是 dev 调试字段, 用户不需要看到, 全删. */}
                    <div className="wk-rt-field">
                        <label>{t("base.runtimes.common.version")}</label>
                        <span className="wk-rt-mono">
                            {rt.version || "N/A"}
                            {this.props.versionHints[rt.id]?.has_update && (
                                <span className="wk-rt-update-hint"> → {this.props.versionHints[rt.id].latest_version}</span>
                            )}
                            {this.renderComponentUpgradeBtn(this.props.versionHints[rt.id]?.has_update)}
                        </span>
                    </div>
                    {(() => {
                        // 「Octo 插件版本」行: provider 有 octo 适配插件概念
                        // (openclaw→octo / claude→cc-octo)才显示本行 —— 已上报插件
                        // 则显版本(+升级),未装则显「安装」按钮,否则中性占位「—」.
                        const plugins = (metadata as any)?.plugins
                        const octoComponent = octoComponentName(rt.provider)
                        const octoPlugin = Array.isArray(plugins) && octoComponent
                            ? (plugins as any[]).find((p: any) => p.name === octoComponent)
                            : undefined
                        // octoComponent 非 null ⟺ provider 有 octo 适配插件概念
                        // (openclaw/claude)。没装插件且该 provider 无适配插件概念
                        // (unknown/codex 等)时整行不显示。
                        if (!octoPlugin && !octoComponent) return null
                        const pluginHint = this.props.versionHints[rt.id]
                        return (
                            <div className="wk-rt-field">
                                <label>{t("base.runtimes.runtime.octoPluginVersion")}</label>
                                <span className="wk-rt-mono">
                                    {octoPlugin ? (
                                        <>
                                            {octoPlugin.version}
                                            {pluginHint?.has_plugin_update && (
                                                <span className="wk-rt-update-hint"> → {pluginHint.plugin_latest_version}</span>
                                            )}
                                            {this.renderPluginUpgradeBtn(octoComponent ?? "", pluginHint?.has_plugin_update)}
                                        </>
                                    ) : (
                                        // openclaw 的 octo 插件未装 → 显「安装」按钮(一键装到 latest);
                                        // claude 的 cc-octo 插件未装且有可安装版本 → 显「安装」按钮,点击弹 modal 收集网关+key;
                                        // 其它无插件数据时用中性占位「—」。
                                        canInstallOctoPlugin(rt.provider, false)
                                            ? this.renderPluginUpgradeBtn(octoComponent ?? "", undefined, "install")
                                            : shouldShowCcInstall(rt.provider, false, pluginHint?.plugin_install_version)
                                                ? this.renderPluginUpgradeBtn(octoComponent ?? "", undefined, "install", () => this.props.onCcInstallOpen?.(this.props.runtime))
                                                : <span className="wk-rt-install-empty">—</span>
                                    )}
                                </span>
                            </div>
                        )
                    })()}
                </div>

                {/* PR-2: 删 BotsSection (Bot 列表 + 新建按钮) — 跟左侧
                    树 Level 3 的 bot rows 重复, "新建" 也跟顶部 + popover
                    的"创建 Bot"重复. caster 拍的去重. */}

                <div className="wk-rt-detail-footer">
                    <span>{t("base.runtimes.runtime.createdAt", { values: { time: rt.created_at } })}</span>
                    <span>{t("base.runtimes.runtime.updatedAt", { values: { time: rt.updated_at } })}</span>
                </div>
                {deleting && <div className="wk-rt-deleting-overlay">{t("base.runtimes.runtime.deleting")}</div>}
            </div>
        )
    }
}

// ─── RuntimesPage: two-level list (Device → Agent) ─────────────────────

// botStatusLabel 已抽到 botsApi.ts (单源, 跟 Bot 类型同文件), BotsTab
// 也共用同一份, 不再两边 inline ternary 漂移.

// PR-2: Level 3 bot row 抽成 functional 子组件, 让头像绿点能复用
// useChannelOnline hook —— 信号源跟 BotDetailPanel + IM 私聊列表一致
// (WuKongIM channelInfo.online === 1, 不是 fleet bot.status). class
// component 调不了 hook 所以抽出去.
function useChannelOnline(channel: Channel | null): boolean {
    const [online, setOnline] = React.useState<boolean>(() => {
        if (!channel) return false
        const info = WKSDK.shared().channelManager.getChannelInfo(channel)
        return (info?.online as any) === 1 || (info?.online as any) === true
    })
    React.useEffect(() => {
        if (!channel) return
        const read = () => {
            const info = WKSDK.shared().channelManager.getChannelInfo(channel)
            setOnline((info?.online as any) === 1 || (info?.online as any) === true)
        }
        read()
        const t = window.setInterval(read, 2000)
        return () => window.clearInterval(t)
    }, [channel?.channelID, channel?.channelType])
    return online
}

interface BotRowProps {
    bot: Bot
    onOpen: (id: number) => void
}

function BotRow({ bot, onOpen }: BotRowProps) {
    const botChannel = React.useMemo(
        () => bot.bot_uid ? new Channel(bot.bot_uid, ChannelTypePerson) : null,
        [bot.bot_uid],
    )
    const isOnline = useChannelOnline(botChannel)
    const openChat = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (botChannel) (WKApp as any).endpoints?.showConversation?.(botChannel)
    }
    return (
        <div
            className="wk-rt-bot-row"
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpen(bot.id) }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen(bot.id)
                }
            }}
        >
            <div
                className={`wk-rt-bot-avatar-wrap${botChannel ? " wk-rt-clickable" : ""}`}
                title={botChannel ? t("base.runtimes.botDetail.openDM") : undefined}
                // C9 fix: 没 botChannel 时不挂 onClick, 否则空 handler
                // stopPropagation 会吞掉点击, 让头像区变 dead zone (用户
                // 看到头像点没反应, 行级 onOpen 也不触发).
                onClick={botChannel ? openChat : undefined}
            >
                {botChannel ? (
                    <WKAvatar channel={botChannel} style={{ width: 20, height: 20, borderRadius: 4 }} />
                ) : (
                    <span className={`wk-rt-bot-dot ${bot.status === "failed" ? "failed" : "pending"}`} />
                )}
                {isOnline && <span className="wk-rt-online-dot" title={t("base.runtimes.common.online")} />}
            </div>
            <span className="wk-rt-bot-name">{bot.name}</span>
            {/* bot.status==='active' 时
                头像绿点已经表达"在线", 不再显示"在线"文字避免重复 — 仅
                非 active 状态显示 (配置中/失败/草稿/已归档 是有信息量的). */}
            {bot.status !== "active" && (
                <span className="wk-rt-bot-status">{botStatusLabel(bot.status)}</span>
            )}
        </div>
    )
}

interface RuntimesPageState extends RuntimesState {
    createMenuOpen: boolean
    runtimeModalOpen: boolean
    // PR-2 Level 3: runtime row expand → bot list under that runtime.
    // Lazy-load: bots fetched once when a runtime is first expanded, cache
    // is invalidated on space-change and on bot create. PR-3 may add a soft
    // poll to keep the list fresh while expanded.
    expandedRuntimes: Set<number>
    botsByRuntime: Map<number, Bot[]>
    botsLoading: Set<number>
    // botsByRuntime 首次水合标记. 没水合前 (首屏 loadData →
    // refreshAllBots 在飞) 不能把所有 runtime 按 "0 bot" 渲染成不可展开 —
    // 回退到旧的 "可展开 + 展开时懒加载" 行为, 水合后才用 "没 bot 不可
    // 展开" 新逻辑.
    botsHydrated: boolean
}

export default class RuntimesPage extends Component<{}, RuntimesPageState> {
    botsTabRef = React.createRef<BotsTabHandle>()

    // C9 in-flight guard: 切 space 时 epoch++ , refreshRuntimeBots 的
    // .then 回到时若 epoch 变了就丢弃结果, 防旧 space 响应回填到清空后
    // 的 botsByRuntime (fleet runtime id 全局递增不撞数据, 但避免 dead
    // 条目残留).
    private spaceEpoch = 0

    state: RuntimesPageState = {
        runtimes: [],
        devices: {},
        versionHints: {},
        daemonVersionHints: {},
        activeUpgrades: {},
        loading: true,
        selectedId: null,
        expandedDevices: new Set<string>(),
        createMenuOpen: false,
        runtimeModalOpen: false,
        expandedRuntimes: new Set<number>(),
        botsByRuntime: new Map<number, Bot[]>(),
        botsLoading: new Set<number>(),
        botsHydrated: false,
        ccInstallTarget: null,
        pendingCcInstall: null,
    }

    private ccInstallToken = 0

    private pollTimer?: ReturnType<typeof setInterval>
    private selectedDeviceKey?: string

    // C1: BotsTab 创建成功后刷该 runtime 的 Level-3 cache, 用户当前
    // 看到的 bot 列表立刻包含新建项. 同时把父 device 也展开 — 用户
    // 从顶部 + popover 创建时 device 行可能未展开, 仅展开 runtime 看不
    // 到 (上层 device 折叠把整 subtree 藏了), tree 链路体感断.
    //
    // 创建成功后 BotsTab.selectBot 会把
    // BotDetailPanel 推到 routeRight, 此时 selectedId 不能停留在某个
    // agent 上 — 否则 silent loadData 15s 后 showAgentDetail 把 Bot pane
    // 替换回 RuntimeDetail. selectedDeviceKey 同理 (DeviceDetail 路径).
    private handleBotCreated = (bot: Bot) => {
        this.refreshRuntimeBots(bot.runtime_id)
        const rt = this.state.runtimes.find(r => r.id === bot.runtime_id)
        // 左树 device 身份键 = device_id 字符串, 跟 groupByDevice 的 key 公式
        // 对齐 (device_id 优先, 老数据回退 daemon_id / 'unknown'). 否则父
        // device 行不展开, 用户看不到刚建的 bot.
        const deviceKey = rt?.device_id ? String(rt.device_id) : (rt?.daemon_id || "unknown")
        this.selectedDeviceKey = undefined
        this.setState((prev) => {
            const expandedRuntimes = prev.expandedRuntimes.has(bot.runtime_id)
                ? prev.expandedRuntimes
                : new Set(prev.expandedRuntimes).add(bot.runtime_id)
            const expandedDevices = prev.expandedDevices.has(deviceKey)
                ? prev.expandedDevices
                : new Set(prev.expandedDevices).add(deviceKey)
            return { selectedId: null, expandedRuntimes, expandedDevices }
        })
    }

    private handleSpaceChanged = () => {
        this.spaceEpoch++
        // C5: 切 space 时也得清 expandedRuntimes / botsByRuntime / botsLoading,
        // 否则 fleet 给 runtime id 是全局递增的不会重复, 但 bot 缓存仍然会绑到
        // 上一 space 的 runtime — 用户切回原 space 看到的还是旧 list 直到
        // refreshRuntimeBots 触发.
        this.setState({
            selectedId: null,
            // 切 space 即清空 runtime 视图 —— 否则旧 space 的 runtimes 会残留到新 space
            // 首次 loadData 返回前;若该 loadData 失败 (catch 仅复位 loading=false 不清
            // runtimes),`canBot=!loading && canCreateBot(runtimes)` 会用旧 space 的在线
            // 运行时误启用「创建 Bot」。清空后失败也回落到禁用。
            runtimes: [],
            devices: {},
            versionHints: {},
            daemonVersionHints: {},
            activeUpgrades: {},
            expandedDevices: new Set(),
            expandedRuntimes: new Set(),
            botsByRuntime: new Map(),
            botsLoading: new Set(),
            botsHydrated: false,
            ccInstallTarget: null,
            pendingCcInstall: null,
        })
        // 新 space 的首次全量 bot 拉取不受旧 space 节流时间戳约束
        this.lastAllBotsAt = 0
        WKApp.routeRight.popToRoot()
        this.loadData()
    }

    // C6 a11y: popover Escape close + focus return. document keydown 监听
    // 期间 menu 打开 + Escape 触发关 + 把焦点退回 + 按钮.
    private createBtnRef = React.createRef<HTMLButtonElement>()
    private handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && this.state.createMenuOpen) {
            this.setState({ createMenuOpen: false }, () => {
                this.createBtnRef.current?.focus()
            })
        }
    }

    // 页面重新可见 / 窗口聚焦时立即拉一次最新 — 自适应轮询管页面内,
    // 管不到"用户切走 tab 期间不看、切回看到旧帧"这个盲区. visibilitychange
    // 与 focus 同一次切回会双触发, 且 focus 在页面内点击也乱触发, 故 1.5s
    // 节流去重 (loadData 的 loadSeq 再兜竞态). silent 不闪 loading.
    private lastVisRefresh = 0
    private onVisible = () => {
        if (document.visibilityState !== "visible") return
        const now = Date.now()
        if (now - this.lastVisRefresh < 1500) return
        this.lastVisRefresh = now
        void this.loadData(true)
        // 重置 pollTimer 对齐到"刚刷过"的点: tab 切后台时 setInterval 可能被
        // 浏览器节流堆积, 切回时补跑的 poll 若紧随本次 loadData 启动会递增
        // loadSeq 把这次"切回刷新"的响应判 stale (轻则延迟、重则该 poll 失败
        // 时本次切回不落数据). 重置后下一轮 poll 从现在起算, 不抢这次刷新.
        this.startPollTimer(this.currentPollMs)
    }

    private unsubscribeLocale?: () => void

    componentDidMount() {
        this.loadData()
        this.startPollTimer(POLL_IDLE_MS)
        WKApp.mittBus.on("space-changed", this.handleSpaceChanged)
        document.addEventListener("keydown", this.handleGlobalKeyDown)
        document.addEventListener("visibilitychange", this.onVisible)
        window.addEventListener("focus", this.onVisible)
        // These are class components and don't consume the I18nProvider context,
        // so a live locale switch wouldn't re-render them (the page kept the old
        // language until navigating away and back). Subscribe at the page root
        // and forceUpdate — re-rendering RuntimesPage cascades through the whole
        // Runtimes tree (DeviceDetail / RuntimeDetail / rows) so every t() call
        // re-evaluates against the new locale.
        this.unsubscribeLocale = i18n.subscribe(() => this.forceUpdate())
    }

    componentWillUnmount() {
        if (this.pollTimer) clearInterval(this.pollTimer)
        WKApp.mittBus.off("space-changed", this.handleSpaceChanged)
        document.removeEventListener("keydown", this.handleGlobalKeyDown)
        document.removeEventListener("visibilitychange", this.onVisible)
        window.removeEventListener("focus", this.onVisible)
        this.unsubscribeLocale?.()
    }

    // 升级期间临时加速兜底轮询 (runtime页升级状态不刷新 修复方案 2):
    // pollPluginUpgrade/pollComponentUpgrade 协程寄生在 detail 组件实例上
    // (isStale = unmounted || runtime.id 变), 分钟级升级期间用户切走节点
    // 协程就死 — 只剩页面级轮询兜底. 15s 间隔让"升级完成→页面终态"最坏
    // ~20s+, 体感是"一直不刷新". 有 in-progress 升级任务时把页面级轮询
    // 降到 3s, 全部终态后恢复 15s — 兜底不再依赖组件实例协程死活.
    // 间隔切换只在档位翻转时重建 timer (防每 tick 重建).
    private currentPollMs = POLL_IDLE_MS

    private startPollTimer(ms: number) {
        if (this.pollTimer) clearInterval(this.pollTimer)
        this.currentPollMs = ms
        this.pollTimer = setInterval(() => this.loadData(true), ms)
    }

    private adjustPollInterval() {
        const anyInProgress = Object.values(this.state.activeUpgrades)
            .some(u => isUpgradeInProgress(u.status))
        const want = anyInProgress ? POLL_UPGRADE_MS : POLL_IDLE_MS
        if (want !== this.currentPollMs) this.startPollTimer(want)
    }

    // C-2 (plan-upgrade-mutex-ux X1): 同 space 请求序号. onUpgradeStarted
    // 立即 loadData 跟 15s 定时轮询并发时, 旧响应晚到会覆盖新 activeUpgrades
    // (busyDaemons 短暂清空 → 按钮闪烁可点). 序号比 epoch 细一级: epoch
    // 隔离跨 space, seq 隔离同 space 多请求.
    private loadSeq = 0

    async loadData(silent = false) {
        // C9 in-flight guard: 切 space 时 epoch++, 旧 space 在飞的
        // /runtimes 响应回来时若 epoch 变了就丢弃, 防旧 space runtimes /
        // versionHints / activeUpgrades 回填到新 space.
        // C-2: seq 一并入 isStale 闭包, 覆盖全部三个检查点 (await 后 /
        // setState updater 内 / setState callback 内).
        const epoch = this.spaceEpoch
        const seq = ++this.loadSeq
        const isStale = () => this.spaceEpoch !== epoch || seq !== this.loadSeq
        if (!silent) this.setState({ loading: true })
        try {
            const spaceId = WKApp.shared.currentSpaceId
            if (!spaceId) {
                if (isStale()) return
                this.setState({ runtimes: [], loading: false })
                return
            }
            const res = (await WKApp.apiClient.get("/runtimes", { param: { space_id: spaceId }, baseURL: fleetApiBase() }))?.data
            if (isStale()) return
            // Compatible with both array (old) and object (new) response
            const runtimes: AgentRuntime[] = Array.isArray(res) ? res : (res?.runtimes || [])
            const devices: Record<string, Device> = Array.isArray(res) ? {} : (res?.devices || {})
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
                    if (isStale()) return null
                    const expanded = new Set(prev.expandedDevices)
                    if (prev.expandedDevices.size === 0 && (Object.keys(devices).length > 0 || runtimes.length > 0)) {
                        const groups = groupByDevice(runtimes, devices)
                        groups.forEach(g => expanded.add(g.key))
                    }
                    return { runtimes, devices, versionHints, daemonVersionHints, activeUpgrades, loading: false, expandedDevices: expanded }
                },
                () => {
                    if (isStale()) return
                    // 左树 Level-3 需要每个 runtime 的 bot 数判断"能否展开"
                    // (没 bot 不可展开) — 批量回填 botsByRuntime.
                    this.refreshAllBots()
                    // 升级期间临时加速轮询 (15s ↔ 3s 两档, 见 adjustPollInterval)
                    this.adjustPollInterval()
                    // 放 callback 里：保证 showAgentDetail / showDeviceDetail 里读到的
                    // this.state.activeUpgrades 是本轮刚拉到的，而不是 setState 之前的快照。
                    // guard 必须是"运行时页当前是否是激活菜单"：
                    //   - 不能用 `WKApp.route.currentPath === "/runtimes"`：左侧导航切菜单
                    //     不更新 route.currentPath（一直停在 "/"），恒为 false → silent
                    //     loadData 永不重推右栏，是插件装完/升级完原地不刷新的根因。
                    //   - 也不能直接 `if (silent)`：切到别的菜单时本页不会 unmount（菜单用
                    //     display:none 保活），pollTimer 仍在跑，selectedId 也不随菜单切换
                    //     清空；裸 silent 会把 RuntimeDetail 重推盖到共享 routeRight 右栏，
                    //     劫持用户当前正在看的别的菜单。
                    // WKApp.currentMenuId 每次菜单切换都维护，正好表达 ownership。
                    if (silent && WKApp.currentMenuId === "runtimes") {
                        if (this.state.selectedId != null) {
                            const updated = runtimes.find(r => r.id === this.state.selectedId)
                            if (updated) {
                                this.showAgentDetail(updated)
                            } else {
                                this.setState({ selectedId: null })
                                WKApp.routeRight.popToRoot()
                            }
                        } else if (this.selectedDeviceKey) {
                            // B-4 (P1/X2): 原条件还要求 activeUpgrades 里有
                            // `${daemonId}:octo-daemon` — 只覆盖 daemon 自身
                            // 升级, component/plugin 升级引起的 daemonBusy
                            // 变化 (出现和消失两个方向) 推不到已打开的
                            // DeviceDetail. 放宽为打开着就重渲染, 跟上面
                            // RuntimeDetail 分支对齐. replaceToRoot 幂等,
                            // 15s 一次成本可忽略.
                            const groups = groupByDevice(runtimes, this.state.devices)
                            const updated = groups.find(g => g.key === this.selectedDeviceKey)
                            if (updated) {
                                this.showDeviceDetail(updated)
                            }
                        }
                    }
                },
            )
        } catch {
            if (isStale()) return
            if (!silent) this.setState({ loading: false })
        } finally {
            // X7: loading 兜底归"最新请求"管 — seq 不是最新说明
            // 有更新的请求在飞, 它的成功/finally 路径会收尾, 本请求不动
            // (防旧 non-silent 把新 non-silent 刚设的 loading 提前翻掉).
            // seq 是最新且 loading 还挂着 (e.g. non-silent 被 silent 抢先
            // 淘汰后 silent 失败) 才兜底翻 false.
            if (seq === this.loadSeq && this.state.loading) {
                this.setState({ loading: false })
            }
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

    // PR-2 Level 3: toggle a runtime row's expanded state and lazy-load
    // its bot list on first expand.
    //
    // C11 fix: setState updater 保持纯 (函数式 setState), 但用 outer
    // `let` 暂存 needFirstLoad 给 setState 第二参 callback 用. 这样:
    //   - StrictMode 下 updater 跑两次, 但 needFirstLoad 只是 boolean,
    //     不会触发副作用 (refreshRuntimeBots 只在 callback 里调一次)
    //   - 直接读 this.state 后 setState 会丢同 tick 多次 toggle 的中间
    //     态; 函数式 prev 永远拿最新.
    toggleRuntime = (runtimeId: number) => {
        let needFirstLoad = false
        this.setState((prev) => {
            const willExpand = !prev.expandedRuntimes.has(runtimeId)
            const expanded = new Set(prev.expandedRuntimes)
            if (willExpand) expanded.add(runtimeId)
            else expanded.delete(runtimeId)
            needFirstLoad = willExpand
                && !prev.botsByRuntime.has(runtimeId)
                && !prev.botsLoading.has(runtimeId)
            return { expandedRuntimes: expanded }
        }, () => {
            if (needFirstLoad) this.refreshRuntimeBots(runtimeId)
        })
    }

    // caster 2026-06-12: 左树 Level-3 空态简化 — "没 bot 的 runtime 不能
    // 展开" 需要预先知道每个 runtime 的 bot 数 (原来是展开时懒加载).
    // listBots() 本来就一次返回全 space 的 bot (refreshRuntimeBots 是客户
    // 端过滤), 这里批量按 runtime_id 分组回填 botsByRuntime. 由 loadData
    // 每 15s 调用 — 也顺带让 Level-3 bot 行保持新鲜 (别处创建的 bot 会出现).
    //
    // refreshAllBots 整 Map 替换跟
    // refreshRuntimeBots 单 key 合并是双路并发写 — 旧全量响应晚到会覆盖
    // 新单 key 结果 (e.g. 刚创建 bot 后 handleBotCreated 的单 key 刷新被
    // 更早起飞的全量覆盖, 新 bot 左树短暂消失). botsSeq 模块级序号统一
    // 两路: 任一新请求起飞使旧响应作废.
    private botsSeq = 0
    // refreshAllBots 自带节流 — 升级期间
    // loadData 降到 3s 档时, bot 数据跟升级无关, 不该连带 5 倍 listBots.
    // 阈值取 0.8× 轮询间隔 (12s) 而不是打平 15s — 打平时 15s tick
    // 到达常差几十 ms 不满阈值被跳过, 空闲态退化成 ~30s 隔轮生效.
    private lastAllBotsAt = 0

    refreshAllBots = async () => {
        if (Date.now() - this.lastAllBotsAt < POLL_IDLE_MS * 0.8) return
        const epoch = this.spaceEpoch
        const seq = ++this.botsSeq
        const isStale = () => this.spaceEpoch !== epoch || seq !== this.botsSeq
        try {
            const all = await listBots()
            if (isStale()) return
            this.lastAllBotsAt = Date.now()
            this.setState((prev) => {
                if (isStale()) return null
                const next = new Map<number, Bot[]>()
                for (const b of all) {
                    const arr = next.get(b.runtime_id)
                    if (arr) arr.push(b)
                    else next.set(b.runtime_id, [b])
                }
                // 没 bot 的 runtime 也写空数组 — 区分 "已加载, 0 个" 跟
                // "没加载过" (后者不再出现, 但 Map.get undefined 兜底仍在).
                for (const rt of prev.runtimes) {
                    if (!next.has(rt.id)) next.set(rt.id, [])
                }
                // 首屏 botsByRuntime 未水合前不能按 "0 bot" 渲染
                // (所有 runtime 都没箭头, 数据回来箭头才冒出来). hydrated
                // 标记让 render 在水合前回退到 "可展开 + 懒加载" 旧行为.
                return { botsByRuntime: next, botsHydrated: true }
            })
        } catch {
            // 静默: 保留旧 cache (botsHydrated 不动 — 首次失败时维持
            // 未水合的可展开回退, 不会把全树误判成无 bot), 下轮 15s 再试
        }
    }

    refreshRuntimeBots = async (runtimeId: number) => {
        // C9 in-flight guard: 进 epoch 闭包, 响应回来时若 epoch 变过
        // (期间切了 space) 就丢弃, 防旧 space 数据回填.
        // botsSeq 跟 refreshAllBots 共用 — 单 key 刷新起飞也
        // 使在飞的全量响应作废 (双路写 botsByRuntime 的最新 wins).
        const epoch = this.spaceEpoch
        const seq = ++this.botsSeq
        const isStale = () => this.spaceEpoch !== epoch || seq !== this.botsSeq
        this.setState((prev) => {
            if (isStale()) return null
            const loading = new Set(prev.botsLoading)
            loading.add(runtimeId)
            return { botsLoading: loading }
        })
        try {
            // listBots returns all bots in the current space; filter by
            // runtime_id for this row's view. Tiny dataset (PoC scale)
            // so per-runtime fan-out isn't worth the API surface.
            const all = await listBots()
            if (isStale()) return
            const forThis = all.filter(b => b.runtime_id === runtimeId)
            this.setState((prev) => {
                if (isStale()) return null
                const next = new Map(prev.botsByRuntime)
                next.set(runtimeId, forThis)
                const loading = new Set(prev.botsLoading)
                loading.delete(runtimeId)
                return { botsByRuntime: next, botsLoading: loading }
            }, () => {
                // RuntimeDetail 经
                // routeRight.replaceToRoot 命令式渲染, 不在 React tree 内
                // 接收新 props. cache miss 后这里的 setState 只刷新左树
                // botsByRuntime cache, 已 mount 的 RuntimeDetail 不会自动
                // 拿到新 botCount. 所以 setState 完成后, 若当前右侧 detail
                // 正指向该 runtimeId, 重新调 showAgentDetail 把带新
                // botCount 的 RuntimeDetail replaceToRoot 推过去.
                if (isStale()) return
                if (this.state.selectedId === runtimeId) {
                    const rt = this.state.runtimes.find(r => r.id === runtimeId)
                    if (rt) this.showAgentDetail(rt)
                }
            })
        } catch (e) {
            this.setState((prev) => {
                if (isStale()) return null
                const loading = new Set(prev.botsLoading)
                loading.delete(runtimeId)
                return { botsLoading: loading }
            })
        } finally {
            // 本请求被 botsSeq 作废 (更新
            // 的 refreshAllBots / 别的单 key 请求起飞) 时, 上面所有
            // setState 都被 isStale 挡住 — botsLoading 里的标记没人清,
            // 若接班的全量请求恰好失败, "加载中…" 挂死且 needFirstLoad
            // 被 botsLoading.has 抑制无法重试. epoch 没变 (同 space) 时
            // 兜底清掉本 runtime 的 loading 标记 (幂等, 接班请求成功路径
            // 也会清). epoch 变了不管 — handleSpaceChanged 整体重置.
            if (this.spaceEpoch === epoch && seq !== this.botsSeq) {
                this.setState((prev) => {
                    if (this.spaceEpoch !== epoch || !prev.botsLoading.has(runtimeId)) return null
                    const loading = new Set(prev.botsLoading)
                    loading.delete(runtimeId)
                    return { botsLoading: loading }
                })
            }
        }
    }

    // B-1/B-2 (plan-upgrade-mutex-ux): 该 daemon 是否有任一 in-progress
    // 升级 task (无论 component). 集合语义跟 fleet insertUpgradeTask 互斥
    // 判定一致 — busy 时同 daemon 其他 Upgrade 必被 fleet 拒.
    private isDaemonBusy = (daemonId: string): boolean => {
        return Object.values(this.state.activeUpgrades).some(
            u => u.daemon_id === daemonId && isUpgradeInProgress(u.status)
        )
    }

    // C-1: detail 页 POST /runtimes/upgrade 成功后立即 silent 重拉, 让
    // busyDaemons ~1s 内更新到所有打开的 detail (不等 15s 轮询). silent
    // 必须 true — loadData 的 re-replaceToRoot callback 只在 silent 分支
    // 执行, false 还会闪 loading.
    private handleUpgradeStarted = () => { this.loadData(true) }

    showDeviceDetail = (group: DeviceGroup) => {
        this.setState({ selectedId: null })
        this.selectedDeviceKey = group.key
        // hint key = device_id (group.key); 升级 POST / activeUpgrade key 仍用 daemon_id.
        const daemonId = group.device.daemon_id
        WKApp.routeRight.replaceToRoot(
            <DeviceDetail
                group={group}
                daemonVersionHint={this.state.daemonVersionHints[group.key]}
                activeUpgrade={this.state.activeUpgrades[`${daemonId}:octo-daemon`]}
                daemonBusy={this.isDaemonBusy(daemonId)}
                onUpgradeStarted={this.handleUpgradeStarted}
            />
        )
    }

    // cc install modal lives at page level so an entered gateway/key/model
    // survives the detail pane's 15s-poll re-push / remount. The runtime is
    // captured here at click time, so the install target is stable even if the
    // pane re-selects/re-pushes while the modal is open.
    handleCcInstallOpen = (rt: AgentRuntime) => {
        this.setState({ ccInstallTarget: rt })
    }

    // Modal submit: hand the install to RuntimeDetail as a one-shot prop so it
    // runs through the polled handlePluginUpgrade lifecycle (which surfaces
    // failed/timeout). We do NOT POST here — POSTing without polling would lose
    // the terminal error. Ensure the target runtime's detail is the open pane,
    // then stamp the request with a token (page-level dedup survives re-pushes).
    submitCcInstall = (rt: AgentRuntime, component: string, secret: { gatewayUrl: string; apiKey: string; model?: string }) => {
        const token = ++this.ccInstallToken
        this.setState({ ccInstallTarget: null, pendingCcInstall: { token, runtimeId: rt.id, component, secret } }, () => {
            // Make sure the detail pane for this runtime is mounted/selected so it
            // can consume the request (it reads pendingCcInstall via props).
            if (this.state.selectedId !== rt.id) {
                this.showAgentDetail(rt)
            } else {
                this.showAgentDetail(rt) // re-push so the new prop reaches the pane
            }
        })
    }

    // The detail reports it has started the install for `token`; clear it so a
    // later re-push can't re-trigger. Guard on token to avoid clobbering a newer
    // request.
    handleCcInstallConsumed = (token: number) => {
        if (this.state.pendingCcInstall?.token === token) {
            this.setState({ pendingCcInstall: null })
        }
    }

    showAgentDetail = (rt: AgentRuntime) => {
        this.setState({ selectedId: rt.id })
        this.selectedDeviceKey = undefined
        const pluginUpgrade = this.state.activeUpgrades[`${rt.id}:${octoComponentName(rt.provider) ?? "octo"}`]
        const componentUpgrade = this.state.activeUpgrades[`${rt.id}:${rt.provider}`]
        // botCount 先用 botsByRuntime cache 当前值 (miss 时为 0). cache miss
        // 时触发一次 refreshRuntimeBots, 它的 setState callback 会在数据
        // 回来后 re-replaceToRoot 注入正确 botCount (见 refreshRuntimeBots
        // 注释) — RuntimeDetail 走命令式 routeRight 渲染不在 React tree
        // 内, 不会自动收到新 props 必须命令式 re-replace.
        const cachedBots = this.state.botsByRuntime.get(rt.id)
        if (cachedBots === undefined && !this.state.botsLoading.has(rt.id)) {
            this.refreshRuntimeBots(rt.id)
        }
        WKApp.routeRight.replaceToRoot(
            <RuntimeDetail
                runtime={rt}
                versionHints={this.state.versionHints}
                pluginActiveUpgrade={pluginUpgrade}
                componentActiveUpgrade={componentUpgrade}
                botCount={cachedBots?.length ?? 0}
                daemonBusy={this.isDaemonBusy(rt.daemon_id)}
                onUpgradeStarted={this.handleUpgradeStarted}
                onCcInstallOpen={this.handleCcInstallOpen}
                pendingCcInstall={this.state.pendingCcInstall ?? undefined}
                onCcInstallConsumed={this.handleCcInstallConsumed}
                onDelete={() => {
                    this.setState({ selectedId: null })
                    WKApp.routeRight.popToRoot()
                    this.loadData()
                }}
                onAgentsChanged={() => this.loadData()}
            />
        )
    }

    render() {
        const { runtimes, devices, selectedId, loading, expandedDevices, createMenuOpen, runtimeModalOpen } = this.state
        const groups = groupByDevice(runtimes, devices)
        // gating「创建 Bot」: 仅当本 space 已加载完成(非 loading)且有 ≥1 在线运行时才允许。
        // 切 space 时 handleSpaceChanged 已清空 runtimes:[];!loading 为兜底 —— 覆盖加载
        // 窗口期,以及 loadData 失败(catch 仅复位 loading=false、runtimes 保持 [])的场景,
        // 防旧 space 在线运行时短暂误启用。
        const canBot = !loading && canCreateBot(runtimes)

        return (
            <div className="wk-rt-list">
                <CreateRuntimeModal
                    visible={runtimeModalOpen}
                    onClose={() => this.setState({ runtimeModalOpen: false })}
                />
                <BotsTab ref={this.botsTabRef} hidden onBotCreated={this.handleBotCreated} />

                <div className="wk-rt-pageheader">
                    <div className="wk-rt-pagetitle">
                        <h2 className="wk-rt-pagetitle-text">{t("base.runtimes.title")}</h2>
                        <div className="wk-rt-create-wrap">
                            <button
                                ref={this.createBtnRef}
                                type="button"
                                className="wk-rt-create-btn"
                                aria-haspopup="menu"
                                aria-expanded={createMenuOpen}
                                aria-label={t("base.runtimes.create.newAria")}
                                onClick={() => this.setState({ createMenuOpen: !createMenuOpen })}
                            ><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.67v10.66M2.67 8h10.66" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
                            {createMenuOpen && (
                                <>
                                    <div
                                        className="wk-rt-create-overlay"
                                        onClick={() => this.setState({ createMenuOpen: false })}
                                    />
                                    <div className="wk-rt-create-menu" role="menu">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="wk-rt-create-menu-item"
                                            onClick={() => this.setState({ createMenuOpen: false, runtimeModalOpen: true })}
                                        >
                                            <span className="wk-rt-create-menu-icon" aria-hidden="true">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                                                    <line x1="8" y1="21" x2="16" y2="21"/>
                                                    <line x1="12" y1="17" x2="12" y2="21"/>
                                                </svg>
                                            </span>
                                            <span className="wk-rt-create-menu-text">
                                                <span className="wk-rt-create-menu-title">{t("base.runtimes.create.createRuntime")}</span>
                                                <span className="wk-rt-create-menu-desc">{t("base.runtimes.create.createRuntimeDesc")}</span>
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className={`wk-rt-create-menu-item${canBot ? "" : " wk-rt-create-menu-item--disabled"}`}
                                            aria-disabled={!canBot}
                                            title={canBot ? undefined : t("base.runtimes.create.createBotDisabledHint")}
                                            onClick={() => {
                                                if (!canBot) return
                                                this.setState({ createMenuOpen: false }, () => this.botsTabRef.current?.openCreate())
                                            }}
                                        >
                                            <span className="wk-rt-create-menu-icon" aria-hidden="true">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="11" width="18" height="10" rx="2" />
                                                    <circle cx="12" cy="5" r="2" />
                                                    <path d="M12 7v4" />
                                                    <line x1="8" y1="16" x2="8" y2="16" />
                                                    <line x1="16" y1="16" x2="16" y2="16" />
                                                </svg>
                                            </span>
                                            <span className="wk-rt-create-menu-text">
                                                <span className="wk-rt-create-menu-title">{t("base.runtimes.create.createBot")}</span>
                                                <span className="wk-rt-create-menu-desc">{canBot ? t("base.runtimes.create.createBotDesc") : t("base.runtimes.create.createBotDisabledHint")}</span>
                                            </span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="wk-rt-list-items">
                    {loading && <div className="wk-rt-empty">{t("base.runtimes.common.loading")}</div>}
                    {!loading && groups.length === 0 && (
                        <div className="wk-rt-empty">{t("base.runtimes.empty")}</div>
                    )}
                    {groups.map((group) => {
                        const expanded = expandedDevices.has(group.key)
                        const anyOnline = deviceOnline(group)
                        return (
                            <div key={group.key} className="wk-rt-device-group">
                                {/* Level 1: Device */}
                                <div
                                    className="wk-rt-device-row"
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={expanded}
                                    onClick={() => this.toggleDevice(group.key)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault()
                                            this.toggleDevice(group.key)
                                        }
                                    }}
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
                                        {/* caster 2026-06-12: 删 "N 个运行时" 副标题 — 顶栏已有
                                            "N devices · M runtimes" 计数, device 行重复显示噪音 */}
                                        <div className="wk-rt-device-name">{group.device.name}</div>
                                    </div>
                                    <div className={`wk-rt-status-dot ${anyOnline ? "online" : "offline"}`} />
                                </div>

                                {/* Level 2: Agents (runtime kind) */}
                                {expanded && group.runtimes.map((rt) => {
                                    // caster 2026-06-12: 没 bot 的 runtime 不可展开 — 删掉
                                    // "该运行时下暂无 Bot + 在此创建" 空态 (创建入口顶栏 +
                                    // 已有). botsByRuntime 由 loadData → refreshAllBots 批量
                                    // 预填 (15s), 不再依赖展开时懒加载.
                                    //
                                    // 首屏水合前 (refreshAllBots 还没回来)
                                    // botsByRuntime 全空, 不能按 "0 bot" 把全树渲染成不可
                                    // 展开 — 回退旧 "可展开 + 懒加载" 行为, 水合后才启用
                                    // 新逻辑. 失败时 botsHydrated 维持 false 同样回退.
                                    const bots = this.state.botsByRuntime.get(rt.id) || []
                                    const expandable = !this.state.botsHydrated || bots.length > 0
                                    const rtExpanded = expandable && this.state.expandedRuntimes.has(rt.id)
                                    const botsLoading = this.state.botsLoading.has(rt.id)
                                    return (
                                        <div key={rt.id} className="wk-rt-rt-block">
                                            <div
                                                className={`wk-rt-agent-row ${selectedId === rt.id ? "selected" : ""}`}
                                                // a11y: 不可展开行不再播报成可操作的
                                                // 折叠按钮 — role/tabIndex/aria-expanded 仅在
                                                // expandable 时给 (此页 a11y 之前 C6 专门修过).
                                                role={expandable ? "button" : undefined}
                                                tabIndex={expandable ? 0 : undefined}
                                                aria-expanded={expandable ? rtExpanded : undefined}
                                                onClick={() => { if (expandable) this.toggleRuntime(rt.id) }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault()
                                                        if (expandable) this.toggleRuntime(rt.id)
                                                    }
                                                }}
                                            >
                                                {/* 没 bot 时不渲染箭头, 占位保持缩进对齐 */}
                                                {expandable
                                                    ? <span className={`wk-rt-expand-arrow ${rtExpanded ? "expanded" : ""}`}>&#9654;</span>
                                                    : <span className="wk-rt-expand-arrow placeholder" aria-hidden="true" />}
                                                <div className="wk-rt-provider-icon small">
                                                    <ProviderLogo provider={rt.provider} className="wk-rt-provider-mark" />
                                                </div>
                                                <div
                                                    className="wk-rt-list-item-info"
                                                    onClick={(e) => { e.stopPropagation(); this.showAgentDetail(rt) }}
                                                >
                                                    <div className="wk-rt-list-item-name">
                                                        {providerLabels[rt.provider] || rt.provider}
                                                    </div>
                                                    <div className="wk-rt-list-item-sub">{rt.version}</div>
                                                </div>
                                                {/* PR-2: runtime row 绿点删 — 探活责任在 device row, 由
                                                    daemon 进程 heartbeat 决定; runtime kind 是 daemon 内 adapter
                                                    实例, 不是独立进程, 单独显示绿点会让人误以为各 runtime 各自
                                                    探活. caster 拍的去重. */}
                                            </div>

                                            {/* Level 3: Bots under this runtime (没 bot 不可展开,
                                                空态文案 + 在此创建 CTA 已删 — caster 2026-06-12.
                                                水合前回退懒加载, 保留加载中指示) */}
                                            {rtExpanded && (
                                                <div className="wk-rt-bot-rows">
                                                    {botsLoading && bots.length === 0 && (
                                                        <div className="wk-rt-bot-loading">{t("base.runtimes.common.loading")}</div>
                                                    )}
                                                    {bots.map((b) => (
                                                        <BotRow
                                                            key={b.id}
                                                            bot={b}
                                                            onOpen={(id) => {
                                                                // 打开 Bot 详情前清
                                                                // selectedId / selectedDeviceKey, 否则 15s silent
                                                                // loadData 触发 showAgentDetail() 把 routeRight 上
                                                                // 当前 BotDetailPanel 强行 replaceToRoot 回 RuntimeDetail
                                                                // (route vs routeRight 是两个 manager,
                                                                // currentPath==='/runtimes' guard 区分不出来).
                                                                this.setState({ selectedId: null })
                                                                this.selectedDeviceKey = undefined
                                                                this.botsTabRef.current?.openBot(id)
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
                </div>
                {this.state.ccInstallTarget && (
                    <CcInstallModal
                        onCancel={() => this.setState({ ccInstallTarget: null })}
                        onSubmit={(gatewayUrl, apiKey, model) => {
                            const target = this.state.ccInstallTarget
                            if (!target) return
                            // Hand the install to RuntimeDetail (submitCcInstall) so it runs
                            // through the polled handlePluginUpgrade lifecycle and surfaces
                            // failed/timeout. The modal lives here, not in the pane, so typed
                            // credentials survive a 15s-poll re-push while filling the form.
                            const comp = octoComponentName(target.provider) ?? "cc-octo"
                            this.submitCcInstall(target, comp, { gatewayUrl, apiKey, model })
                        }}
                    />
                )}
            </div>
        )
    }
}
