import classNames from "classnames";
import React from "react";
import { Component } from "react";
import WKViewQueue, { WKViewQueueContext } from "../WKViewQueue";

import { throttle } from "../../Utils/rateLimit";
import {
    SMALL_SCREEN_WIDTH,
    SPLITTER_MIN_WIDTH,
    SPLITTER_DEFAULT_WIDTH,
    clampWidth,
    restoreWidth,
    persistWidth,
} from "./layoutWidth";
import "./index.css"

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

interface WKLayoutState {
    leftWidth: number
    isDragging: boolean
}

export class WKLayout extends Component<WKLayoutProps, WKLayoutState>{
    gResize!: (this: Window, ev: UIEvent) => any
    rightContext!: WKViewQueueContext
    routeLister!:VoidFunction
    private layoutRef = React.createRef<HTMLDivElement>()
    private dragStartX = 0
    private dragStartWidth = 0
    private lastWidth = SPLITTER_DEFAULT_WIDTH
    private cachedContainerWidth = 1200  // updated in mount + resize

    constructor(props: any) {
        super(props)
        this.gResize = this.resize

        const savedWidth = restoreWidth()
        this.lastWidth = savedWidth
        this.state = {
            leftWidth: savedWidth,
            isDragging: false,
        }
    }

    componentDidMount() {
        window.addEventListener("resize", this.gResize)
        this.updateContainerWidth()

        this.routeLister = ()=>{
            this.setState({})
        }
        this.rightContext.addRouteListener(this.routeLister)
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.gResize)
        this.rightContext.removeRouteListener(this.routeLister)
        document.removeEventListener('mousemove', this.onDragMove)
        document.removeEventListener('mouseup', this.onDragEnd)
    }

    resize = throttle(() => {
        this.updateContainerWidth()
        this.setState({})
    }, 100)

    private updateContainerWidth() {
        if (!this.layoutRef.current) return
        const contentEl = this.layoutRef.current.querySelector('.wk-layout-content') as HTMLElement
        if (contentEl) {
            this.cachedContainerWidth = contentEl.clientWidth
        }
    }

    private onDoubleClick = () => {
        this.lastWidth = SPLITTER_DEFAULT_WIDTH
        this.setState({ leftWidth: SPLITTER_DEFAULT_WIDTH })
        persistWidth(SPLITTER_DEFAULT_WIDTH)
    }

    private onDragStart = (e: React.MouseEvent) => {
        e.preventDefault()
        this.dragStartX = e.clientX
        this.dragStartWidth = this.lastWidth
        this.setState({ isDragging: true })
        document.addEventListener('mousemove', this.onDragMove)
        document.addEventListener('mouseup', this.onDragEnd)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }

    private onDragMove = (e: MouseEvent) => {
        const delta = e.clientX - this.dragStartX
        const containerWidth = this.cachedContainerWidth
        const newWidth = clampWidth(this.dragStartWidth + delta, containerWidth)
        this.lastWidth = newWidth

        // Write CSS variables directly — skip React re-render during drag
        const content = this.layoutRef.current?.querySelector('.wk-layout-content') as HTMLElement
        if (content) {
            const px = newWidth + 'px'
            content.style.setProperty('--wk-width-layout-content-left', px)
            content.style.setProperty('--wk-wdith-conversation-list', px)  // legacy typo
        }
        const left = this.layoutRef.current?.querySelector('.wk-layout-content-left') as HTMLElement
        if (left) {
            left.style.width = newWidth + 'px'
        }
    }

    private onDragEnd = () => {
        document.removeEventListener('mousemove', this.onDragMove)
        document.removeEventListener('mouseup', this.onDragEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Commit final width to React state (single re-render)
        this.setState({ leftWidth: this.lastWidth, isDragging: false })
        persistWidth(this.lastWidth)
    }

    render() {
        const { onRenderTab, contentLeft,contentRight,onLeftContext,onRightContext } = this.props
        const isExtension = (window as any).__POWERED_EXTENSION__
        const isSmallScreen = window.innerWidth <= SMALL_SCREEN_WIDTH
        const { leftWidth, isDragging } = this.state

        const tabElement = <div className="wk-layout-tab">
            {
                onRenderTab && onRenderTab(isSmallScreen ? ScreenSize.small : ScreenSize.normal)
            }
        </div>

        // Clamp against cached container width so window resize doesn't break layout
        const clampedWidth = clampWidth(leftWidth, this.cachedContainerWidth)

        const widthPx = `${clampedWidth}px`

        // CSS variables for splitter positioning + nested chat content-left
        // Note: --wk-wdith-conversation-list uses the legacy typo from App.css
        const contentStyle = isSmallScreen ? undefined : {
            '--wk-width-layout-content-left': widthPx,
            '--wk-wdith-conversation-list': widthPx,
        } as React.CSSProperties

        const leftStyle = isSmallScreen ? undefined : {
            width: widthPx,
        }

        const contentElement = <div
            className={classNames(
                "wk-layout-content",
                this.rightContext?.viewCount() > 0 ? "wk-layout-open" : undefined,
            )}
            style={contentStyle}
        >
            <div className="wk-layout-content-left" style={leftStyle}>
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
            {/* Draggable splitter — absolutely positioned, hidden on small screens */}
            <div
                className={classNames("wk-layout-splitter", isDragging && "wk-layout-splitter-active")}
                onMouseDown={this.onDragStart}
                onDoubleClick={this.onDoubleClick}
            >
                <div className="wk-layout-splitter-line" />
            </div>
        </div>

        return <div className="wk-layout" ref={this.layoutRef}>
            {isExtension ? <>{contentElement}{tabElement}</> : <>{tabElement}{contentElement}</>}
            {isDragging && <div className="wk-layout-drag-overlay" />}
        </div>
    }
}
