import classNames from "classnames";
import React from "react";
import { Component } from "react";
import WKViewQueue, { WKViewQueueContext } from "../WKViewQueue";
import "./index.css"

const smallScreenWidth = 640 // 小屏最大宽度（index.css @media screen 里也需要改成这个值的大小）

export enum ScreenSize {
    normal,
    small
}

export interface WKLayoutProps {
    onRenderTab?: (size: ScreenSize) => JSX.Element
    contentLeft?: JSX.Element
    contentRight?:JSX.Element
    onLeftContext?:(context:WKViewQueueContext)=>void
    onRightContext?:(context:WKViewQueueContext)=>void

}

export class WKLayout extends Component<WKLayoutProps>{
    gResize!: (this: Window, ev: UIEvent) => any
    rightContext!: WKViewQueueContext
    routeLister!:VoidFunction
    constructor(props: any) {
        super(props)
        this.gResize = this.resize.bind(this)
    }

    componentDidMount() {
        window.addEventListener("resize", this.gResize)

        this.routeLister = ()=>{
            this.setState({})
        }
        this.rightContext.addRouteListener(this.routeLister)
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.gResize)
        this.rightContext.removeRouteListener(this.routeLister)
    }

    resize() {
        this.setState({})
    }

    render() {
        const { onRenderTab, contentLeft,contentRight,onLeftContext,onRightContext } = this.props
        return <div className="wk-layout">
            <div className="wk-layout-tab">
                {
                    onRenderTab && onRenderTab(window.innerWidth <= smallScreenWidth ? ScreenSize.small : ScreenSize.normal)
                }
            </div>
            <div className={classNames("wk-layout-content",this.rightContext?.viewCount()>0?"wk-layout-open":undefined)}>
                <div className="wk-layout-content-left">
                    <WKViewQueue onContext={(context) => {
                        if(onLeftContext) {
                            onLeftContext(context)
                        }
                    }}>
                        {contentLeft}
                    </WKViewQueue>
                </div>
                <div className="wk-layout-content-right">
                    <WKViewQueue onContext={(context) => {
                        this.rightContext = context
                        if(onRightContext) {
                            onRightContext(context)
                        }
                    }}>
                        {contentRight}
                    </WKViewQueue>
                </div>
            </div>
        </div>
    }
}