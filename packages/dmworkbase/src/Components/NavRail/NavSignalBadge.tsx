import React, { Component } from "react"
import { WKSDK, ConnectStatus } from "wukongimjssdk"
import WKApp from "../../App"

interface NavSignalBadgeState {
    status: ConnectStatus
    latency: number | null
    connectedSince: number | null
    showTooltip: boolean
}

interface NavSignalBadgeProps {
    showText?: boolean
}

export default class NavSignalBadge extends Component<NavSignalBadgeProps, NavSignalBadgeState> {
    private statusListener: any
    private pingTimer: any

    state: NavSignalBadgeState = {
        status: WKSDK.shared().connectManager.status,
        latency: null,
        connectedSince: null,
        showTooltip: false,
    }

    componentDidMount() {
        this.statusListener = (status: ConnectStatus) => {
            if (status === ConnectStatus.Connected) {
                this.startPing()
                this.setState({ status, connectedSince: Date.now() })
            } else {
                this.stopPing()
                this.setState({ status, latency: null, connectedSince: null })
            }
        }
        WKSDK.shared().connectManager.addConnectStatusListener(this.statusListener)

        if (WKSDK.shared().connectManager.status === ConnectStatus.Connected) {
            this.startPing()
            this.setState({ connectedSince: Date.now() })
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
            await fetch(`${WKApp.apiClient.config.apiURL}/health`, { method: "GET", cache: "no-cache" })
            const latency = Date.now() - start
            if (WKSDK.shared().connectManager.status === ConnectStatus.Connected) {
                this.setState({ latency })
            }
        } catch { /* ignore */ }
    }

    getBars(ms: number | null, connected: boolean): number {
        if (!connected) return 0
        if (ms === null) return 2
        if (ms < 100) return 3
        if (ms <= 300) return 2
        return 1
    }

    getColor(ms: number | null, connected: boolean, connecting: boolean): string {
        if (!connected) return connecting ? "#eab308" : "#9ca3af"
        if (ms === null) return "#22c55e"
        if (ms < 100) return "#22c55e"
        if (ms <= 300) return "#eab308"
        return "#ef4444"
    }

    formatDuration(since: number | null): string {
        if (!since) return ""
        const sec = Math.floor((Date.now() - since) / 1000)
        if (sec < 60) return `${sec}秒`
        const min = Math.floor(sec / 60)
        if (min < 60) return `${min}分钟`
        const hr = Math.floor(min / 60)
        return `${hr}小时${min % 60}分`
    }

    handleClick = () => {
        if (this.state.status !== ConnectStatus.Connected) {
            WKSDK.shared().connectManager.connect()
        }
    }

    render() {
        const { status, latency, showTooltip } = this.state
        const { showText } = this.props
        const connected = status === ConnectStatus.Connected
        const connecting = status === ConnectStatus.Connecting
        const bars = this.getBars(latency, connected)
        const color = this.getColor(latency, connected, connecting)

        const labelText = connected && latency !== null
            ? `${latency}ms`
            : connecting ? "连接中" : "已断开"

        return (
            <div
                className={`wk-navrail__signal${connecting ? " wk-navrail__signal--blink" : ""}${showText ? " wk-navrail__signal--with-text" : ""}`}
                onClick={this.handleClick}
                onMouseEnter={() => this.setState({ showTooltip: true })}
                onMouseLeave={() => this.setState({ showTooltip: false })}
                style={{ cursor: connected ? "default" : "pointer" }}
            >
                <svg width="12" height="12" viewBox="0 0 16 16">
                    <rect x="1" y="11" width="3" height="5" rx="0.5" fill={bars >= 1 ? color : "var(--wk-border-default)"} />
                    <rect x="6" y="7" width="3" height="9" rx="0.5" fill={bars >= 2 ? color : "var(--wk-border-default)"} />
                    <rect x="11" y="3" width="3" height="13" rx="0.5" fill={bars >= 3 ? color : "var(--wk-border-default)"} />
                </svg>
                {showText && (
                    <span style={{ fontSize: 11, color, marginLeft: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {labelText}
                    </span>
                )}
                {showTooltip && (
                    <div className="wk-navrail__signal-tooltip">
                        <div>状态：{connected ? "已连接" : connecting ? "连接中" : "已断开"}</div>
                        {connected && latency !== null && <div>延迟：{latency}ms</div>}
                        {connected && this.state.connectedSince && <div>已连接：{this.formatDuration(this.state.connectedSince)}</div>}
                        {!connected && !connecting && <div style={{ color: "var(--wk-brand-primary)", marginTop: 4 }}>点击重连</div>}
                    </div>
                )}
            </div>
        )
    }
}
