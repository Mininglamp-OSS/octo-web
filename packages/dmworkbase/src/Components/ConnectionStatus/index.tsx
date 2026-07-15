import React, { Component } from "react"
import { WKSDK, ConnectStatus } from "wukongimjssdk"
import WKApp from "../../App"
import { I18nContext } from "../../i18n"
import { apiFetch } from "../../Service/apiFetch"
import {
    addImConnectStatusListener,
    getImConnectStatus,
    isImConnected,
    reconnectImWhenNotConnected,
    removeImConnectStatusListener,
} from "../../im-runtime/connectStatus"
import "./index.css"

interface ConnectionStatusProps {
    /** compact=true：只显示信号格+ms，hover 显示 tooltip（NavRail 用）
     *  compact=false（默认）：完整展示，信号格+文字+tooltip */
    compact?: boolean
}

interface ConnectionStatusState {
    status: ConnectStatus
    latency: number | null
    connectedSince: number | null
    showTooltip: boolean
}

export default class ConnectionStatus extends Component<ConnectionStatusProps, ConnectionStatusState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    private statusListener: any
    private pingTimer: any
    private connectedTime: number = 0

    state: ConnectionStatusState = {
        status: getImConnectStatus(WKSDK.shared()),
        latency: null,
        connectedSince: null,
        showTooltip: false,
    }

    componentDidMount() {
        this.statusListener = (status: ConnectStatus) => {
            const newState: Partial<ConnectionStatusState> = { status }
            if (status === ConnectStatus.Connected) {
                this.connectedTime = Date.now()
                newState.connectedSince = this.connectedTime
                this.startPing()
            } else {
                newState.latency = null
                this.stopPing()
            }
            this.setState(newState as any)
        }
        addImConnectStatusListener(WKSDK.shared(), this.statusListener)

        if (isImConnected(WKSDK.shared())) {
            this.connectedTime = Date.now()
            this.setState({ connectedSince: this.connectedTime })
            this.startPing()
        }
    }

    componentWillUnmount() {
        removeImConnectStatusListener(WKSDK.shared(), this.statusListener)
        this.stopPing()
    }

    startPing() {
        this.stopPing()
        this.measureLatency()
        this.pingTimer = setInterval(() => this.measureLatency(), 5000)
    }

    stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer)
            this.pingTimer = null
        }
    }

    async measureLatency() {
        try {
            const start = Date.now()
            const baseUrl = WKApp.apiClient.config.apiURL.replace(/\/+$/, '')
            await apiFetch(`${baseUrl}/health`, {
                method: "GET",
                cache: "no-cache",
            })
            const latency = Date.now() - start
            if (isImConnected(WKSDK.shared())) {
                const nextState: Partial<ConnectionStatusState> = {
                    status: ConnectStatus.Connected,
                    latency,
                }
                if (!this.state.connectedSince) {
                    this.connectedTime = Date.now()
                    nextState.connectedSince = this.connectedTime
                }
                this.setState(nextState)
            }
        } catch {
            if (!isImConnected(WKSDK.shared())) {
                this.connectedTime = 0
                this.setState({
                    status: ConnectStatus.Disconnect,
                    latency: null,
                    connectedSince: null,
                })
            } else {
                this.setState({ latency: null })
            }
        }
    }

    getLatencyColor(ms: number): string {
        if (ms < 100) return "#22c55e"
        if (ms <= 300) return "#eab308"
        return "#ef4444"
    }

    getSignalBars(ms: number | null, connected: boolean): number {
        if (!connected) return 0
        if (ms === null) return 2
        if (ms < 100) return 3
        if (ms <= 300) return 2
        return 1
    }

    formatDuration(since: number | null, translate: React.ContextType<typeof I18nContext>["t"]): string {
        if (!since) return ""
        const sec = Math.floor((Date.now() - since) / 1000)
        if (sec < 60) return translate("base.connectionStatus.duration.seconds", { values: { count: sec } })
        const min = Math.floor(sec / 60)
        if (min < 60) return translate("base.connectionStatus.duration.minutes", { values: { count: min } })
        const hr = Math.floor(min / 60)
        return translate("base.connectionStatus.duration.hoursMinutes", { values: { hours: hr, minutes: min % 60 } })
    }

    handleClick = () => {
        reconnectImWhenNotConnected(WKSDK.shared(), this.state.status)
    }

    render() {
        const { status, latency, connectedSince, showTooltip } = this.state
        const { compact } = this.props
        const { t } = this.context
        const connected = status === ConnectStatus.Connected
        const connecting = status === ConnectStatus.Connecting
        const bars = this.getSignalBars(latency, connected)

        const barColor = !connected
            ? (connecting ? "#eab308" : "#ef4444")
            : (latency !== null ? this.getLatencyColor(latency) : "#22c55e")

        const inactiveBar = "var(--wk-border-default)"

        const labelText = connected && latency !== null
            ? `${latency}ms`
            : connecting ? t("base.connectionStatus.connectingDots") : t("base.connectionStatus.disconnected")

        const tooltip = showTooltip && (
            <div className="wk-conn-tooltip">
                <div>
                    {t("base.connectionStatus.statusLabel")}
                    {connected
                        ? t("base.connectionStatus.connected")
                        : connecting
                            ? t("base.connectionStatus.connecting")
                            : t("base.connectionStatus.disconnected")}
                </div>
                {connected && latency !== null && <div>{t("base.connectionStatus.latencyLabel")}{latency}ms</div>}
                {connected && connectedSince && (
                    <div>
                        {t("base.connectionStatus.connectedForLabel")}
                        {this.formatDuration(connectedSince, t)}
                    </div>
                )}
                {!connected && !connecting && (
                    <div style={{ color: "var(--wk-brand-primary)", marginTop: 4 }}>
                        {t("base.connectionStatus.clickReconnect")}
                    </div>
                )}
            </div>
        )

        const svgBars = (size: number) => (
            <svg width={size} height={size} viewBox="0 0 16 16" className={connecting ? "wk-conn-blink" : ""}>
                <rect x="1" y="11" width="3" height="5" rx="0.5" fill={bars >= 1 ? barColor : inactiveBar} />
                <rect x="6" y="7" width="3" height="9" rx="0.5" fill={bars >= 2 ? barColor : inactiveBar} />
                <rect x="11" y="3" width="3" height="13" rx="0.5" fill={bars >= 3 ? barColor : inactiveBar} />
            </svg>
        )

        if (compact) {
            return (
                <div
                    className={`wk-conn-status wk-conn-status--compact${connecting ? " wk-conn-blink-wrap" : ""}`}
                    onClick={this.handleClick}
                    onMouseEnter={() => this.setState({ showTooltip: true })}
                    onMouseLeave={() => this.setState({ showTooltip: false })}
                    style={{ cursor: "default" }}
                >
                    {svgBars(12)}
                    <span style={{ fontSize: 11, color: barColor, marginLeft: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {labelText}
                    </span>
                    {tooltip}
                </div>
            )
        }

        return (
            <div
                className="wk-conn-status"
                onClick={this.handleClick}
                onMouseEnter={() => this.setState({ showTooltip: true })}
                onMouseLeave={() => this.setState({ showTooltip: false })}
                style={{ cursor: connected ? "default" : "pointer" }}
            >
                {svgBars(14)}
                <span className="wk-conn-text" style={{ color: barColor }}>
                    {labelText}
                </span>
                {tooltip}
            </div>
        )
    }
}
