import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectStatus } from "wukongimjssdk"
import ConnectionStatus from "../index"

const hoisted = vi.hoisted(() => {
    const sdk = {
        connectManager: {
            status: 1,
            addConnectStatusListener: vi.fn(),
            removeConnectStatusListener: vi.fn(),
            connect: vi.fn(),
        },
    }

    return {
        sdk,
        apiFetch: vi.fn(),
    }
})

vi.mock("wukongimjssdk", () => ({
    WKSDK: {
        shared: () => hoisted.sdk,
    },
    ConnectStatus: {
        Connected: 1,
        Disconnect: 0,
        Connecting: 2,
        ConnectKick: 3,
    },
}))

vi.mock("../../../App", () => ({
    default: {
        apiClient: {
            config: {
                apiURL: "https://api.example.com/",
            },
        },
    },
}))

vi.mock("../../../Service/apiFetch", () => ({
    apiFetch: hoisted.apiFetch,
}))

vi.mock("../../../i18n", async () => {
    const React = await vi.importActual<typeof import("react")>("react")
    return {
        I18nContext: React.createContext({
            t: (key: string) => key,
        }),
    }
})

type ConnectionStatusState = ConnectionStatus["state"]
type ConnectionStatusSetState = Parameters<ConnectionStatus["setState"]>[0]

function createConnectionStatus(state?: Partial<ConnectionStatusState>, props: { compact?: boolean } = {}) {
    const component = new ConnectionStatus(props)
    component.state = {
        status: ConnectStatus.Connected,
        latency: 88,
        connectedSince: 1234,
        showTooltip: false,
        ...state,
    }
    component.setState = ((nextState: ConnectionStatusSetState) => {
        Object.assign(
            component.state,
            typeof nextState === "function" ? nextState(component.state, component.props) : nextState
        )
    }) as typeof component.setState
    return component
}

function renderComponent(component: ConnectionStatus) {
    component.context = {
        t: (key: string) => key,
        locale: "zh-CN",
        setLocale: vi.fn(),
    } as any
    return renderToStaticMarkup(component.render())
}

describe("ConnectionStatus render", () => {
    beforeEach(() => {
        hoisted.sdk.connectManager.connect.mockReset()
    })

    it("shows connected text when connected latency is not available yet", () => {
        const component = createConnectionStatus({ latency: null })

        const html = renderComponent(component)

        expect(html).toContain("base.connectionStatus.connected")
        expect(html).not.toContain("base.connectionStatus.disconnected")
    })

    it("keeps compact disconnected status interactive", () => {
        const component = createConnectionStatus({
            status: ConnectStatus.Disconnect,
            latency: null,
            connectedSince: null,
        }, { compact: true })

        const html = renderComponent(component)
        component.handleClick()

        expect(html).toContain("role=\"button\"")
        expect(html).toContain("cursor:pointer")
        expect(html).toContain("base.connectionStatus.disconnected")
        expect(hoisted.sdk.connectManager.connect).toHaveBeenCalledTimes(1)
    })
})

describe("ConnectionStatus measureLatency", () => {
    beforeEach(() => {
        hoisted.sdk.connectManager.status = ConnectStatus.Connected
        hoisted.sdk.connectManager.connect.mockReset()
        hoisted.apiFetch.mockReset()
    })

    it("keeps websocket status when health check fails while SDK is still connected", async () => {
        hoisted.apiFetch.mockRejectedValue(new Error("health unavailable"))
        const component = createConnectionStatus()

        await component.measureLatency()

        expect(hoisted.apiFetch).toHaveBeenCalledWith("https://api.example.com/health", {
            method: "GET",
            cache: "no-cache",
        })
        expect(component.state.status).toBe(ConnectStatus.Connected)
        expect(component.state.latency).toBeNull()
        expect(component.state.connectedSince).toBe(1234)
    })

    it("marks disconnected when health check fails and SDK is not connected", async () => {
        hoisted.sdk.connectManager.status = ConnectStatus.Disconnect
        hoisted.apiFetch.mockRejectedValue(new Error("network down"))
        const component = createConnectionStatus()

        await component.measureLatency()

        expect(component.state.status).toBe(ConnectStatus.Disconnect)
        expect(component.state.latency).toBeNull()
        expect(component.state.connectedSince).toBeNull()
    })
})
