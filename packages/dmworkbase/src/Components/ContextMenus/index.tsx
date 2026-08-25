import classNames from "classnames";
import type { LucideIcon } from "lucide-react";
import React, { Component, ReactNode } from "react";
import { Dropdown } from "@octo/ui";

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
    /** Lucide 图标组件 */
    icon?: LucideIcon
    /** 危险操作（红色） */
    danger?: boolean
    /** 分隔线（此项时其他字段无效） */
    separator?: boolean
    /** 子菜单项 */
    children?: ContextMenusData[]
    /** 选中态（子菜单项右侧显示主题色 ✓） */
    checked?: boolean
    /**
     * 测试锚点（kebab-case），渲染到 <li> 的 data-testid，供埋点规则命中。
     * 仅用于叶子项:有 children 的父项点击只展开子菜单(stopPropagation + return,不触发 onClick),
     * 给父项挂 testid 会让埋点规则在「仅展开」时误命中。父项请勿设 testid,把它挂到实际执行动作的叶子项上。
     */
    testid?: string
}

// ── 内部：渲染单个图标 ──
function CtxIcon({ icon: Icon }: { icon: LucideIcon }) {
    return <Icon aria-hidden="true" className="ctx-icon" />
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

        this.contextMenusRef
            .querySelectorAll<HTMLElement>(".wk-ctx-submenu")
            .forEach((submenu) => { submenu.style.top = "" })

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

    _positionSubmenu(event: React.MouseEvent<HTMLLIElement>) {
        const submenu = event.currentTarget.querySelector<HTMLElement>(":scope > .wk-ctx-submenu")
        const submenuList = submenu?.querySelector<HTMLElement>(":scope > .wk-ctx-submenu-list")
        if (!submenu || !submenuList) return

        const VIEWPORT_MARGIN = 8
        const SUBMENU_BORDER_HEIGHT = 2
        const parentTop = event.currentTarget.getBoundingClientRect().top
        const submenuHeight = Math.min(
            submenuList.scrollHeight + SUBMENU_BORDER_HEIGHT,
            window.innerHeight - VIEWPORT_MARGIN * 2,
        )
        const lowestTop = VIEWPORT_MARGIN - parentTop
        const highestTop = window.innerHeight - VIEWPORT_MARGIN - parentTop - submenuHeight

        submenu.style.top = `${Math.max(lowestTop, Math.min(0, highestTop))}px`
    }

    _renderItem(m: ContextMenusData, i: number): ReactNode {
        if (m.separator) {
            return <Dropdown.Divider key={i} className="wk-ctx-sep" />
        }

        const hasChildren = m.children && m.children.length > 0

        const submenu = hasChildren ? (
            <div className="wk-ctx-submenu">
                <Dropdown.Menu className="wk-ctx-submenu-list">
                    {m.children!.map((child, ci) => {
                        if (child.separator) {
                            return <Dropdown.Divider key={ci} className="wk-ctx-sep" />
                        }
                        return (
                            <Dropdown.Item
                                key={ci}
                                danger={child.danger}
                                icon={child.icon ? <CtxIcon icon={child.icon} /> : undefined}
                                suffix={child.checked ? (
                                    <span className="wk-ctx-checked">✓</span>
                                ) : undefined}
                                onSelect={(e) => {
                                    e.stopPropagation()
                                    this.hide()
                                    if (child.onClick) child.onClick()
                                }}
                            >
                                {child.title}
                            </Dropdown.Item>
                        )
                    })}
                </Dropdown.Menu>
            </div>
        ) : undefined

        return (
            <Dropdown.Item
                key={i}
                data-testid={m.testid}
                danger={m.danger}
                icon={m.icon ? <CtxIcon icon={m.icon} /> : undefined}
                suffix={hasChildren ? <ArrowIcon /> : undefined}
                shellClassName="wk-ctx-item"
                shellProps={{
                    onMouseEnter: hasChildren ? (event) => this._positionSubmenu(event) : undefined,
                }}
                submenu={submenu}
                closeOnSelect={!hasChildren}
                onSelect={(e) => {
                    if (hasChildren) {
                        e.stopPropagation()
                        return
                    }
                    this.hide()
                    if (m.onClick) m.onClick()
                }}
            >
                {m.title}
            </Dropdown.Item>
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
                    <Dropdown.Menu>
                        {menus && menus.map((m, i) => this._renderItem(m, i))}
                    </Dropdown.Menu>
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
