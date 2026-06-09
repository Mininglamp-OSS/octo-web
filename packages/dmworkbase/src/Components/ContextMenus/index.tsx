import classNames from "classnames";
import React, { HTMLProps } from "react";
import { Component, ReactNode } from "react";

import "./index.css"

export interface ContextMenusProps {
    onContext: (context: ContextMenusContext) => void
    menus?: ContextMenusData[]
    onHide?: () => void
}

export interface ContextMenusState {
    contextOrigin: number
    showContextMenus: boolean
    flipSubmenu: boolean
}

export interface ContextMenusContext {
    show(event: React.MouseEvent<Element, MouseEvent>): void
    hide(): void
    isShow(): boolean
}

export class ContextMenusData {
    title!: string
    onClick?: () => void
    /** SVG path 字符串，例如 'M3 6h18...' */
    icon?: string
    /** 危险操作（红色） */
    danger?: boolean
    /** 分隔线（此项时其他字段无效） */
    separator?: boolean
    /** 子菜单项 */
    children?: ContextMenusData[]
    /** 选中态（子菜单项右侧显示主题色 ✓） */
    checked?: boolean
}

// ── 内部：渲染单个图标 ──
function CtxIcon({ path }: { path: string }) {
    return (
        <svg className="ctx-icon" viewBox="0 0 24 24">
            <path d={path} />
        </svg>
    )
}

// ── 内部：箭头图标 ──
function ArrowIcon() {
    return (
        <svg className="wk-ctx-arrow" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

export default class ContextMenus extends Component<ContextMenusProps, ContextMenusState> implements ContextMenusContext {
    private static _instances: Set<ContextMenus> = new Set()
    private static _documentContextMenuGuardAttached = false
    private _rafId?: number

    static hideAll() {
        ContextMenus._instances.forEach((instance) => {
            if (instance.isShow()) {
                instance.hide()
            }
        })
    }

    private static _hasOpenInstance(): boolean {
        for (const instance of ContextMenus._instances) {
            if (instance.isShow()) return true
        }
        return false
    }

    private static _handleDocumentContextMenu(event: MouseEvent) {
        if (!ContextMenus._hasOpenInstance()) {
            ContextMenus._syncDocumentContextMenuGuard()
            return
        }
        event.preventDefault()
    }

    private static _syncDocumentContextMenuGuard() {
        if (typeof document === "undefined") return

        const shouldAttach = ContextMenus._hasOpenInstance()
        if (shouldAttach && !ContextMenus._documentContextMenuGuardAttached) {
            document.addEventListener("contextmenu", ContextMenus._handleDocumentContextMenu, true)
            ContextMenus._documentContextMenuGuardAttached = true
        } else if (!shouldAttach && ContextMenus._documentContextMenuGuardAttached) {
            document.removeEventListener("contextmenu", ContextMenus._handleDocumentContextMenu, true)
            ContextMenus._documentContextMenuGuardAttached = false
        }
    }

    _gHandleClick!: () => void
    constructor(props: any) {
        super(props)
        this.state = {
            contextOrigin: 0,
            showContextMenus: false,
            flipSubmenu: false,
        }
        this._gHandleClick = this._handleClick.bind(this)
    }

    isShow(): boolean {
        return this.state.showContextMenus
    }

    _handleClick() {
        this.hide()
    }

    hide(): void {
        this.setState({ showContextMenus: false }, () => {
            ContextMenus._syncDocumentContextMenuGuard()
        })
        this.props.onHide?.()
    }

    show(event: React.MouseEvent<Element, MouseEvent>): void {
        event.preventDefault();
        if (!this.contextMenusRef) return

        ContextMenus._instances.forEach((instance) => {
            if (instance !== this && instance.isShow()) instance.hide()
        })

        const clickX = event.clientX;
        const clickY = event.clientY;

        // 第一帧：将菜单放到视口外使其可见，以便量取真实尺寸
        this.contextMenusRef.style.top = '-9999px'
        this.contextMenusRef.style.left = '-9999px'
        this.contextMenusRef.style.visibility = 'hidden'
        this.contextMenusRef.style.display = 'block'

        // 第二帧：读取真实尺寸后计算最终位置
        this._rafId = requestAnimationFrame(() => {
            if (!this.contextMenusRef) return

            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            const rootW = this.contextMenusRef.offsetWidth || 200;
            const rootH = this.contextMenusRef.offsetHeight || 0;
            const MARGIN = 8; // 距视口边缘最小间距

            const showLeft = (screenW - clickX) < rootW + MARGIN
            const showBottom = (screenH - clickY) < rootH + MARGIN

            const left = showLeft ? Math.max(MARGIN, clickX - rootW) : Math.min(clickX + 5, screenW - rootW - MARGIN)
            const top = showBottom ? Math.max(MARGIN, clickY - rootH) : Math.min(clickY, screenH - rootH - MARGIN)

            this.contextMenusRef.style.left = `${left}px`
            this.contextMenusRef.style.top = `${top}px`
            this.contextMenusRef.style.visibility = ''
            this.contextMenusRef.style.display = ''

            const contextOrigin = showBottom ? rootH : 0
            // 子菜单宽度估算 160px（min-width），靠近右侧时翻转
            const SUBMENU_W = 160
            const flipSubmenu = (screenW - left - rootW) < SUBMENU_W + MARGIN
            this.setState({ contextOrigin, showContextMenus: true, flipSubmenu }, () => {
                ContextMenus._syncDocumentContextMenuGuard()
            })
        })
    }

    contextMenusRef!: HTMLDivElement | null

    componentDidMount() {
        ContextMenus._instances.add(this)
        if (this.props.onContext) this.props.onContext(this)
    }

    componentWillUnmount() {
        ContextMenus._instances.delete(this)
        if (this._rafId !== undefined) {
            cancelAnimationFrame(this._rafId)
        }
        ContextMenus._syncDocumentContextMenuGuard()
    }

    _handleContextMenu(event: React.MouseEvent<HTMLElement>) {
        event.preventDefault()
        event.stopPropagation()
    }

    _handleMaskContextMenu(event: React.MouseEvent<HTMLDivElement>) {
        event.preventDefault()
        event.stopPropagation()
        ContextMenus.hideAll()
    }

    _renderItem(m: ContextMenusData, i: number): ReactNode {
        if (m.separator) {
            return <div key={i} className="wk-ctx-sep" />
        }

        const hasChildren = m.children && m.children.length > 0

        return (
            <li
                key={i}
                className={classNames(m.danger && "wk-ctx-danger")}
                onClick={(e) => {
                    if (hasChildren) {
                        e.stopPropagation()
                        return
                    }
                    this.hide()
                    if (m.onClick) m.onClick()
                }}
            >
                {m.icon && <CtxIcon path={m.icon} />}
                <span style={{ flex: 1 }}>{m.title}</span>
                {hasChildren && (
                    <>
                        <ArrowIcon />
                        <ul className="wk-ctx-submenu">
                            {m.children!.map((child, ci) => {
                                if (child.separator) {
                                    return <div key={ci} className="wk-ctx-sep" />
                                }
                                return (
                                    <li
                                        key={ci}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            this.hide()
                                            if (child.onClick) child.onClick()
                                        }}
                                    >
                                        {child.icon && <CtxIcon path={child.icon} />}
                                        <span style={{ flex: 1 }}>{child.title}</span>
                                        {child.checked && (
                                            <span style={{
                                                color: 'var(--wk-brand-primary, #1C1C23)',
                                                fontSize: 13,
                                                fontWeight: 600,
                                                flexShrink: 0,
                                                marginLeft: 4,
                                            }}>✓</span>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    </>
                )}
            </li>
        )
    }

    render(): ReactNode {
        const { showContextMenus, contextOrigin, flipSubmenu } = this.state
        const { menus } = this.props
        return (
            <>
                <div
                    className={classNames("wk-contextmenus", showContextMenus && "wk-contextmenus-open", flipSubmenu && "wk-contextmenus-flip-submenu")}
                    ref={ref => { this.contextMenusRef = ref }}
                    style={{ transformOrigin: `-3px ${contextOrigin}px` }}
                    onContextMenuCapture={this._handleContextMenu}
                >
                    <ul>
                        {menus && menus.map((m, i) => this._renderItem(m, i))}
                    </ul>
                </div>
                <div
                    className="wk-contextmenus-mask"
                    style={{ visibility: showContextMenus ? "visible" : "hidden" }}
                    onClick={() => ContextMenus.hideAll()}
                    onContextMenuCapture={this._handleMaskContextMenu}
                />
            </>
        )
    }
}
