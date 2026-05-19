import React, { Component, HTMLProps } from "react";
import classNames from "classnames";
import "./index.css"
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { Button } from "@douyinfe/semi-ui";
import WKViewQueueHeader from "../WKViewQueueHeader";
import WKViewQueue, { WKViewQueueContext } from "../WKViewQueue";

export interface RoutePageState {
    pushViewCount: number
    routePage?: JSX.Element
    routeConfigs: Array<RouteContextConfig | undefined>
    finishButtonDisable: boolean
    finishButtonLoading: boolean
}

export interface RoutePageProps{
    title?: string
    onClose?: () => void
    render: (context: RouteContext<any>) => React.ReactNode
}

export default class RoutePage extends Component<RoutePageProps, RoutePageState> implements RouteContext<any>, FinishButtonContext {
    private _routeData: any
    viewQueueContext!: WKViewQueueContext
    constructor(props: any) {
        super(props)
        this.state = {
            pushViewCount: 0,
            finishButtonDisable: false,
            finishButtonLoading: false,
            routeConfigs: [],
        }
    }
    loading(loading: boolean): void {
        this.setState({
            finishButtonLoading: loading,
        })
    }
    disable(disable: boolean): void {
        this.setState({
            finishButtonDisable: disable,
        })
    }

    push(view: JSX.Element, config?: RouteContextConfig): void {
        if (config && config.onFinishContext) {
            config.onFinishContext(this)
        }
        const { routeConfigs } = this.state
        routeConfigs.push(config)
        this.setState({
            routeConfigs: routeConfigs,
            pushViewCount: this.state.pushViewCount + 1
        })
        this.viewQueueContext.push(view)
        // if(config && config.onFinishContext) {
        //     config.onFinishContext(this)
        // }
        // console.log("config----->",config)
        // this.setState({
        //     pushed: true,
        //     routePage: view,
        //     routeConfig: config,
        // })
    }
    popToRoot(): void {
        this.setState({
            routeConfigs: [],
            pushViewCount: 0,
        })
        this.viewQueueContext.popToRoot()
    }
    pop(): void {
        const { pushViewCount, routeConfigs } = this.state
        routeConfigs.splice(routeConfigs.length - 1, 1)
        this.setState({
            routeConfigs: routeConfigs,
            pushViewCount: pushViewCount - 1
        })
        this.viewQueueContext.pop()
    }

    /**
     * 原子地替换栈顶视图 —— 不修改 pushViewCount，只换最上层的 routeConfig 和 view。
     *
     * 修复点 (YUJ-1348)：之前调用方在「create 成功 → 跳 edit」场景下用 `pop()` + `push()`
     * 同帧表达替换。但 `pop()` 会做 `setState({ pushViewCount: n-1 })`（异步），而紧跟的
     * `push()` 又通过 `this.state.pushViewCount + 1` 读取陈旧值，结果栈深度从 1 变成
     * 2 而不是「依旧 1」。同时 WKViewQueue.pop 等动画结束才真正移除旧视图，push 又把
     * 新视图追加到旧 queue 末尾 → 实际栈变成 list → create → edit，「back」回到 create
     * 而不是 list。
     *
     * 这里改成单一原子操作：routeConfigs 末尾替换、pushViewCount 不动、viewQueue 同样
     * 原子替换栈顶。栈空时退化为 push（与「在 root 上替换」语义对齐：root 由 render
     * prop 决定，replace 在空栈上等价于 push 一个新顶部）。
     */
    replace(view: JSX.Element, config?: RouteContextConfig): void {
        if (config && config.onFinishContext) {
            config.onFinishContext(this)
        }
        this.setState((prev) => {
            if (prev.pushViewCount === 0) {
                return {
                    routeConfigs: [config],
                    pushViewCount: 1,
                }
            }
            const next = prev.routeConfigs.slice(0, -1)
            next.push(config)
            return {
                routeConfigs: next,
                pushViewCount: prev.pushViewCount,
            }
        })
        this.viewQueueContext.replace(view)
    }

    routeData(): any {
        return this._routeData
    }
    setRouteData(data: any): void {
        this._routeData = data
    }

    componentWillUnmount() {
        this.setState = (state,callback) => {
            return
        }
    }

    render() {
        const { pushViewCount, routeConfigs, finishButtonDisable, finishButtonLoading } = this.state
        const { title, onClose } = this.props
        let routeConfig: RouteContextConfig | undefined
        if (routeConfigs.length > 0) {
            routeConfig = routeConfigs[routeConfigs.length - 1]
        }
        return <div className="wk-route">
            <div className="wk-route-header">
                <div className="wk-route-header-close" onClick={() => {
                    if (pushViewCount > 0) {
                        this.pop()
                        return
                    }
                    if (onClose) {
                        onClose()
                    }
                }}>
                    <div className={classNames("wk-route-header-close-icon", pushViewCount > 0 ? "wk-state-back" : undefined)}>
                    </div>
                </div>
                <div className={classNames("wk-route-header-title-box", pushViewCount > 0 ? "wk-route-header-title-box-open" : undefined)}>
                    <div className="wk-route-header-title">
                        {title}
                    </div>
                    <div className="wk-route-header-title-next">
                        {routeConfig?.title}
                    </div>
                </div>
                <div className={classNames("wk-route-header-right-view", pushViewCount > 0 ? "wk-route-header-right-view-open" : undefined)}>
                    {
                        routeConfig?.showFinishButton ? <Button disabled={finishButtonDisable} loading={finishButtonLoading} theme='solid' type='primary' onClick={() => {
                            if (routeConfig?.onFinish) {
                                routeConfig?.onFinish()
                            }
                        }}>完成</Button> : undefined
                    }
                </div>
            </div>

            <div className="wk-route-box">
                <div className="wk-route-content">
                    <WKViewQueue onContext={(ctx) => {
                        this.viewQueueContext = ctx
                    }}>
                        {this.props.render(this)}
                    </WKViewQueue>
                </div>
            </div>
        </div>
    }
}