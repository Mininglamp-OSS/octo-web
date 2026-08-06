import classNames from "classnames";
import React from "react";
import { Component } from "react";
import WKViewQueue, { WKViewQueueContext } from "../WKViewQueue";

import { throttle } from "../../Utils/rateLimit";
import {
    SMALL_SCREEN_WIDTH,
    SPLITTER_MIN_WIDTH,
    SPLITTER_DEFAULT_WIDTH,
    NAV_RAIL_MIN_WIDTH,
    NAV_RAIL_DEFAULT_WIDTH,
    NAV_RAIL_EXPANDED_THRESHOLD,
    clampWidth,
    restoreWidth,
    persistWidth,
    clampNavRailWidth,
    getNavRailDragWidth,
    restoreNavRailWidth,
    persistNavRailWidth,
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
    navRailWidth: number
    isDragging: boolean
    draggingTarget?: "nav" | "content"
}

export class WKLayout extends Component<WKLayoutProps, WKLayoutState>{
    gResize!: (this: Window, ev: UIEvent) => any
    rightContext!: WKViewQueueContext
    routeLister!:VoidFunction
    private layoutRef = React.createRef<HTMLDivElement>()
    private dragStartX = 0
    private dragStartWidth = 0
    private lastWidth = SPLITTER_DEFAULT_WIDTH
    private lastNavRailWidth = NAV_RAIL_DEFAULT_WIDTH
    private cachedContainerWidth = 1200  // updated in mount + resize
    private cachedLayoutWidth = 1200

    constructor(props: any) {
        super(props)
        this.gResize = this.resize

        const savedWidth = restoreWidth()
        const savedNavRailWidth = restoreNavRailWidth()
        this.lastWidth = savedWidth
        this.lastNavRailWidth = savedNavRailWidth
        this.state = {
            leftWidth: savedWidth,
            navRailWidth: savedNavRailWidth,
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
        document.removeEventListener('mouseout', this.onDocumentMouseOut)
        window.removeEventListener('mouseup', this.onDragEnd)
        window.removeEventListener('blur', this.onDragEnd)
    }

    resize = throttle(() => {
        this.updateContainerWidth()
        this.setState({})
    }, 100)

    private updateContainerWidth() {
        if (!this.layoutRef.current) return
        this.cachedLayoutWidth = this.layoutRef.current.clientWidth || this.cachedLayoutWidth
        const contentEl = this.layoutRef.current.querySelector('.wk-layout-content') as HTMLElement
        if (contentEl) {
            this.cachedContainerWidth = contentEl.clientWidth
        }
    }

    private onContentDoubleClick = () => {
        this.lastWidth = SPLITTER_DEFAULT_WIDTH
        this.setState({ leftWidth: SPLITTER_DEFAULT_WIDTH })
        persistWidth(SPLITTER_DEFAULT_WIDTH)
    }

    private onContentDragStart = (e: React.MouseEvent) => {
        e.preventDefault()
        this.dragStartX = e.clientX
        this.dragStartWidth = this.lastWidth
        this.setState({ isDragging: true, draggingTarget: "content" })
        document.addEventListener('mousemove', this.onDragMove)
        document.addEventListener('mouseup', this.onDragEnd)
        document.addEventListener('mouseout', this.onDocumentMouseOut)
        window.addEventListener('mouseup', this.onDragEnd)
        window.addEventListener('blur', this.onDragEnd)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }

    private onNavDoubleClick = () => {
        this.lastNavRailWidth = NAV_RAIL_DEFAULT_WIDTH
        this.setState({ navRailWidth: NAV_RAIL_DEFAULT_WIDTH })
        persistNavRailWidth(NAV_RAIL_DEFAULT_WIDTH)
    }

    private onNavDragStart = (e: React.MouseEvent) => {
        e.preventDefault()
        this.dragStartX = e.clientX
        this.dragStartWidth = this.lastNavRailWidth
        this.setState({ isDragging: true, draggingTarget: "nav" })
        document.addEventListener('mousemove', this.onDragMove)
        document.addEventListener('mouseup', this.onDragEnd)
        document.addEventListener('mouseout', this.onDocumentMouseOut)
        window.addEventListener('mouseup', this.onDragEnd)
        window.addEventListener('blur', this.onDragEnd)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }

    private onDragMove = (e: MouseEvent) => {
        const delta = e.clientX - this.dragStartX
        if (this.state.draggingTarget === "nav") {
            const newWidth = clampNavRailWidth(getNavRailDragWidth(this.dragStartWidth, delta), this.cachedLayoutWidth)
            this.lastNavRailWidth = newWidth

            const layout = this.layoutRef.current
            if (layout) {
                const px = newWidth + 'px'
                layout.style.setProperty('--wk-width-layout-tab', px)
                const tab = layout.querySelector('.wk-layout-tab') as HTMLElement
                if (tab) {
                    tab.style.width = px
                    tab.classList.toggle('wk-layout-tab-expanded', newWidth >= NAV_RAIL_EXPANDED_THRESHOLD)
                }
            }
            return
        }

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

    private onDocumentMouseOut = (e: MouseEvent) => {
        if (!e.relatedTarget) {
            this.onDragEnd()
        }
    }

    private onDragEnd = () => {
        document.removeEventListener('mousemove', this.onDragMove)
        document.removeEventListener('mouseup', this.onDragEnd)
        document.removeEventListener('mouseout', this.onDocumentMouseOut)
        window.removeEventListener('mouseup', this.onDragEnd)
        window.removeEventListener('blur', this.onDragEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const { draggingTarget } = this.state
        if (!draggingTarget) {
            this.setState({ isDragging: false })
            return
        }
        // Commit final width to React state (single re-render)
        if (draggingTarget === "nav") {
            this.updateContainerWidth()
            this.setState({ navRailWidth: this.lastNavRailWidth, isDragging: false, draggingTarget: undefined })
            persistNavRailWidth(this.lastNavRailWidth)
            return
        }
        this.setState({ leftWidth: this.lastWidth, isDragging: false, draggingTarget: undefined })
        persistWidth(this.lastWidth)
    }

    render() {
        const { onRenderTab, contentLeft,contentRight,onLeftContext,onRightContext } = this.props
        const isExtension = (window as any).__POWERED_EXTENSION__
        const isSmallScreen = window.innerWidth <= SMALL_SCREEN_WIDTH
        const { leftWidth, navRailWidth, isDragging, draggingTarget } = this.state

        const clampedNavRailWidth = isSmallScreen ? NAV_RAIL_DEFAULT_WIDTH : clampNavRailWidth(navRailWidth, this.cachedLayoutWidth)
        const navRailWidthPx = `${clampedNavRailWidth}px`
        const isNavRailExpanded = clampedNavRailWidth >= NAV_RAIL_EXPANDED_THRESHOLD

        const tabElement = <div
            className={classNames("wk-layout-tab", isNavRailExpanded && "wk-layout-tab-expanded")}
            style={isSmallScreen ? undefined : { width: navRailWidthPx }}
        >
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
            '--wk-width-layout-tab': navRailWidthPx,
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
                className={classNames("wk-layout-splitter", isDragging && draggingTarget === "content" && "wk-layout-splitter-active")}
                onMouseDown={this.onContentDragStart}
                onDoubleClick={this.onContentDoubleClick}
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={SPLITTER_MIN_WIDTH}
                aria-valuenow={clampedWidth}
            >
                <div className="wk-layout-splitter-line" />
            </div>
        </div>

        return <div
            className="wk-layout"
            ref={this.layoutRef}
            style={isSmallScreen ? undefined : { '--wk-width-layout-tab': navRailWidthPx } as React.CSSProperties}
        >
            {isExtension ? <>{contentElement}{tabElement}</> : <>{tabElement}{contentElement}</>}
            {!isSmallScreen && !isExtension && (
                <div
                    className={classNames("wk-layout-nav-splitter", isDragging && draggingTarget === "nav" && "wk-layout-nav-splitter-active")}
                    onMouseDown={this.onNavDragStart}
                    onDoubleClick={this.onNavDoubleClick}
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={NAV_RAIL_MIN_WIDTH}
                    aria-valuenow={clampedNavRailWidth}
                >
                    <div className="wk-layout-nav-splitter-line" />
                </div>
            )}
            {isDragging && <div className="wk-layout-drag-overlay" />}
        </div>
    }
}
