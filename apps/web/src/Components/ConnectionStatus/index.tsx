import React, { Component } from "react"
import { WKSDK, ConnectStatus } from "wukongimjssdk"
import { I18nContext, WKApp } from "@octo/base"
import "./index.css"

interface ConnectionStatusState {
    status: ConnectStatus
    latency: number | null
    connectedSince: number | null
    showTooltip: boolean
}

export default class ConnectionStatus extends Component<{}, ConnectionStatusState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    private statusListener: any
    private pingTimer: any
    private connectedTime: number = 0

    state: ConnectionStatusState = {
        status: WKSDK.shared().connectManager.status,
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
        WKSDK.shared().connectManager.addConnectStatusListener(this.statusListener)

        if (WKSDK.shared().connectManager.status === ConnectStatus.Connected) {
            this.connectedTime = Date.now()
            this.setState({ connectedSince: this.connectedTime })
            this.startPing()
        }
    }

    componentWillUnmount() {
        WKSDK.shared().connectManager.removeConnectStatusListener(this.statusListener)
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
            await fetch(`${WKApp.apiClient.config.apiURL}/health`, {
                method: "GET",
                cache: "no-cache",
            })
            const latency = Date.now() - start
            if (WKSDK.shared().connectManager.status === ConnectStatus.Connected) {
                this.setState({ latency })
            }
        } catch {
            // ignore
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

    formatDuration(since: number | null): string {
        if (!since) return ""
        const sec = Math.floor((Date.now() - since) / 1000)
        const { t } = this.context
        if (sec < 60) return t("app.connection.duration.seconds", { values: { count: sec } })
        const min = Math.floor(sec / 60)
        if (min < 60) return t("app.connection.duration.minutes", { values: { count: min } })
        const hr = Math.floor(min / 60)
        return t("app.connection.duration.hoursMinutes", { values: { hours: hr, minutes: min % 60 } })
    }

    handleClick = () => {
        if (this.state.status !== ConnectStatus.Connected) {
            WKSDK.shared().connectManager.connect()
        }
    }

    render() {
        const { status, latency, connectedSince, showTooltip } = this.state
        const { t } = this.context
        const connected = status === ConnectStatus.Connected
        const connecting = status === ConnectStatus.Connecting
        const bars = this.getSignalBars(latency, connected)

        const barColor = !connected
            ? (connecting ? "#eab308" : "#ef4444")
            : (latency !== null ? this.getLatencyColor(latency) : "#22c55e")

        return (
            <div
                className="wk-conn-status"
                onClick={this.handleClick}
                onMouseEnter={() => this.setState({ showTooltip: true })}
                onMouseLeave={() => this.setState({ showTooltip: false })}
                style={{ cursor: connected ? "default" : "pointer" }}
            >
                <svg width="14" height="14" viewBox="0 0 16 16" className={connecting ? "wk-conn-blink" : ""}>
                    <rect x="1" y="11" width="3" height="5" rx="0.5"
                        fill={bars >= 1 ? barColor : "#d1d5db"} />
                    <rect x="6" y="7" width="3" height="9" rx="0.5"
                        fill={bars >= 2 ? barColor : "#d1d5db"} />
                    <rect x="11" y="3" width="3" height="13" rx="0.5"
                        fill={bars >= 3 ? barColor : "#d1d5db"} />
                </svg>
                <span className="wk-conn-text" style={{ color: barColor }}>
                    {connected && latency !== null
                        ? `${latency}ms`
                        : connecting
                            ? t("app.connection.statusConnectingText")
                            : t("app.connection.statusDisconnectedText")}
                </span>
                {showTooltip && (
                    <div className="wk-conn-tooltip">
                        <div>
                            {t("app.connection.tooltip.statusLabel")}
                            {connected
                                ? t("app.connection.statusConnected")
                                : connecting
                                    ? t("app.connection.statusConnecting")
                                    : t("app.connection.statusDisconnected")}
                        </div>
                        {connected && latency !== null && <div>{t("app.connection.tooltip.latencyLabel")}{latency}ms</div>}
                        {connected && connectedSince && <div>{t("app.connection.tooltip.connectedLabel")}{this.formatDuration(connectedSince)}</div>}
                        {!connected && !connecting && <div style={{ color: "#6366f1", marginTop: 4 }}>{t("app.connection.reconnect")}</div>}
                    </div>
                )}
            </div>
        )
    }
}
