import classNames from "classnames";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css"

export interface WKViewQueueContext {
    replaceToRoot(view: JSX.Element): void
    /**
     * 原子地替换栈顶视图（不改 viewCount）。当栈为空时退化为 push。
     *
     * 修复点 (YUJ-1348)：之前调用方在同一帧里 `pop()` 然后 `push()` 来表达「替换」，
     * 但 `pop()` 只是把 status 改成 Pop、等动画结束后才真正从 queues 里删除，
     * 同帧紧跟的 `push()` 会把新视图追加到旧 queues 后面 —— 栈深度变 +1，UI 表现
     * 为「back from edit reveals the create picker again」。这里提供原子 replace
     * 让 RoutePage 之类的上层用单一 setState 完成切换。
     */
    replace(view: JSX.Element): void
    push(view: JSX.Element): void
    pushToFirst(view: JSX.Element): void
    pop(): void
    popToRoot(): void
    viewCount():number

    addRouteListener(callback:()=>void):void // 添加路由监听
    removeRouteListener(callback:()=>void):void // 移除路由监听
}

export interface WKViewQueueProps {
    children: ReactNode;
    onContext?: (context: WKViewQueueContext) => void
}



enum WKViewQueueStatus {
    Normal,
    Push,
    Pop
}

export interface WKViewQueueState {
    queues: JSX.Element[]
    status: WKViewQueueStatus
    viewCount: number
}

export default class WKViewQueue extends Component<WKViewQueueProps, WKViewQueueState> implements WKViewQueueContext {
    private routeListeners: VoidFunction[] = []
    constructor(props: WKViewQueueProps) {
        super(props)
        this.state = {
            queues: [],
            status: WKViewQueueStatus.Normal,
            viewCount: 0,
        }
    }
   
    
    componentDidMount() {
        const { onContext } = this.props
        if (onContext) {
            onContext(this)
        }
    }

    componentWillUnmount() {
    }

    animationEnd() {
        // this.className = "";
        const { status } = this.state
        if(status === WKViewQueueStatus.Pop) {
            this.poped()
        }

        this.setState({
            status: WKViewQueueStatus.Normal
        })
    }

    viewCount(): number {
        const { viewCount } = this.state
    //    return queues.length
    return viewCount
    }

    addRouteListener(callback: () => void): void {
        this.routeListeners.push(callback)
    }
    removeRouteListener(callback: () => void): void {
        const len = this.routeListeners.length;
        for (let i = 0; i < len; i++) {
            if (callback === this.routeListeners[i]) {
                this.routeListeners.splice(i, 1)
                return
            }
        }
    }
    private notifyRouteChange() {
        if (this.routeListeners) {
            this.routeListeners.forEach((listener: VoidFunction) => {
                if (listener) {
                    listener();
                }
            });
        }
    }

    replaceToRoot(view: JSX.Element): void {
        this.setState({
            queues: [view],
            viewCount: 1,
            status: WKViewQueueStatus.Normal,
        },()=>{
            this.notifyRouteChange()
        })
    }
    pop(): void {
        this.setState((prevState) => {
            if (prevState.queues.length === 0) return null;
            return {
                status: WKViewQueueStatus.Pop,
                viewCount: prevState.queues.length - 1,
            };
        }, () => {
            this.notifyRouteChange();
        });
    }

    poped() {
        this.setState((prevState) => ({
            queues: prevState.queues.slice(0, -1),
        }), () => {
            this.notifyRouteChange();
        });
    }

    popToRoot(): void {
        this.setState({
            queues:  [],
            viewCount: 0,
        },()=>{
            this.notifyRouteChange()
        })
    }


    push(view: JSX.Element): void {
       this.setState((prevState) => ({
           queues: [...prevState.queues, view],
           viewCount:  prevState.queues.length + 1,
           status: WKViewQueueStatus.Push,
       }),()=>{
        this.notifyRouteChange()
       })
    }
    /**
     * 替换栈顶 —— 一次 setState 完成，避免 pop()+push() 同帧时 queues 被错误地追加
     * 而非替换（详见 interface 注释）。当栈为空时退化为 push 行为（追加为第一项）。
     *
     * 不触发 Push/Pop 动画：调用方语义是「同位置换内容」，沿用上一次的视觉位姿即可
     * （Normal 状态）。若未来需要带过渡，可在 callsite 自己做（pop -> 等动画 -> push）。
     */
    replace(view: JSX.Element): void {
        this.setState((prevState) => {
            if (prevState.queues.length === 0) {
                return {
                    queues: [view],
                    viewCount: 1,
                    status: WKViewQueueStatus.Normal,
                }
            }
            return {
                queues: [...prevState.queues.slice(0, -1), view],
                viewCount: prevState.queues.length,
                status: WKViewQueueStatus.Normal,
            }
        }, () => {
            this.notifyRouteChange()
        })
    }
    pushToFirst(view: JSX.Element): void {
        throw new Error("Method not implemented.");
    }

    statusClass() {
        const { status } = this.state
        if(status === WKViewQueueStatus.Push) {
            return "wk-viewqueue-view-in"
        }else  if(status === WKViewQueueStatus.Pop) {
            return "wk-viewqueue-view-out"
        }else {
            return ""
        }
    }

    render(): ReactNode {
        const { queues } = this.state
        return <div className="wk-viewqueue">
            <div className="wk-viewqueue-route">
                <div className="wk-viewqueue-view">
                    {this.props.children}
                </div>
                {
                    queues.map((view, i) => {
                        const last = i === queues.length - 1 
                        return <div key={i} onAnimationEnd={() => {
                            if(last) {
                                this.animationEnd()
                            }
                        }} id={last ? "wk-viewqueue-view-last" : undefined} className={classNames("wk-viewqueue-view",last?this.statusClass():undefined)} >
                            {view}
                        </div>
                    })
                }
            </div>

        </div>
    }
}