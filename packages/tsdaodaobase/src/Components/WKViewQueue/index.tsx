import classNames from "classnames";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css"

export interface WKViewQueueContext {
    replaceToRoot(view: JSX.Element): void
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
       
        const { viewCount,queues  } = this.state
        if(queues.length === 0) {
            return
        }
        this.setState({
            status: WKViewQueueStatus.Pop,
            viewCount: queues.length-1,
        },()=>{
            this.notifyRouteChange()
        })
    }

    poped() {
        const {queues} = this.state
        queues.splice(queues.length-1,1)
        
       this.setState({
           queues:  queues,
       },()=>{
           this.notifyRouteChange()
       })
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
       const { queues,viewCount } = this.state
       this.setState({
           queues: [...queues,view],
           viewCount:  queues.length + 1,
           status: WKViewQueueStatus.Push,
       },()=>{
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