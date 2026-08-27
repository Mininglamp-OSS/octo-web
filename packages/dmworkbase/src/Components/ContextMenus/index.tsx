import classNames from "classnames";
import type { LucideIcon } from "lucide-react";
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

export interface ContextMenusTrigger {
    clientX: number
    clientY: number
    preventDefault(): void
}

export interface ContextMenusContext {
    show(event: ContextMenusTrigger): void
    hide(): void
    isShow(): boolean
}

export class ContextMenusData {
    /** 稳定动作标识，不依赖文案或数组位置 */
    actionKey?: string
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
    private _returnFocus?: HTMLElement

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
            const activeElement = document.activeElement
            const focusStayedInMenu = activeElement === document.body
                || Boolean(activeElement && this.contextMenusRef?.contains(activeElement))
            if (focusStayedInMenu && this._returnFocus?.isConnected) this._returnFocus.focus()
            this._returnFocus = undefined
        })
        this.props.onHide?.()
    }

    show(event: ContextMenusTrigger): void {
        event.preventDefault();
        if (!this.contextMenusRef) return

        if (!this.state.showContextMenus) {
            this._returnFocus = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined
        }

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
                this.contextMenusRef
                    ?.querySelector<HTMLElement>(':scope > ul > [role="menuitem"]')
                    ?.focus()
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

    _handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault()
            this.hide()
            return
        }
        if (event.key === "Tab") {
            this.hide()
            return
        }

        const activeItem = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="menuitem"]')
        const activeList = activeItem?.parentElement
        const parentItem = activeList?.closest<HTMLElement>('[role="menuitem"]')
        const items = Array.from(activeList?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? [])
        if (items.length === 0) return
        const current = items.indexOf(activeItem as HTMLElement)
        let next = current
        if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length
        else if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
        else if (event.key === "Home") next = 0
        else if (event.key === "End") next = items.length - 1
        else if (event.key === "ArrowLeft" && parentItem) {
            event.preventDefault()
            parentItem.focus()
            return
        } else if (event.key === "ArrowRight" && activeItem) {
            const firstChild = activeItem.querySelector<HTMLElement>(':scope > .wk-ctx-submenu > ul > [role="menuitem"]')
            if (!firstChild) return
            event.preventDefault()
            firstChild.focus()
            return
        }
        else if ((event.key === "Enter" || event.key === " ") && current >= 0) {
            event.preventDefault()
            const firstChild = items[current].querySelector<HTMLElement>(':scope > .wk-ctx-submenu > ul > [role="menuitem"]')
            if (firstChild) {
                firstChild.focus()
                return
            }
            items[current].click()
            return
        } else return
        event.preventDefault()
        items[next].focus()
    }

    _activateItem(onClick?: () => void) {
        const activeElement = document.activeElement
        if (activeElement && this.contextMenusRef?.contains(activeElement) && this._returnFocus?.isConnected) {
            this._returnFocus.focus()
        }
        this.hide()
        onClick?.()
    }

    _renderItem(m: ContextMenusData, i: number): ReactNode {
        if (m.separator) {
            return <div key={i} className="wk-ctx-sep" role="separator" />
        }

        const hasChildren = m.children && m.children.length > 0

        return (
            <li
                key={i}
                data-action-key={m.actionKey}
                role="menuitem"
                aria-haspopup={hasChildren ? "menu" : undefined}
                tabIndex={-1}
                data-testid={m.testid}
                className={classNames(m.danger && "wk-ctx-danger")}
                onMouseEnter={hasChildren ? (event) => this._positionSubmenu(event) : undefined}
                onClick={(e) => {
                    if (hasChildren) {
                        e.stopPropagation()
                        return
                    }
                    this._activateItem(m.onClick)
                }}
            >
                {m.icon && <CtxIcon icon={m.icon} />}
                <span style={{ flex: 1 }}>{m.title}</span>
                {hasChildren && (
                    <>
                        <ArrowIcon />
                        <div className="wk-ctx-submenu">
                            <ul className="wk-ctx-submenu-list" role="menu">
                                {m.children!.map((child, ci) => {
                                    if (child.separator) {
                                        return <div key={ci} className="wk-ctx-sep" />
                                    }
                                    return (
                                        <li
                                            key={ci}
                                            role="menuitem"
                                            tabIndex={-1}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                this._activateItem(child.onClick)
                                            }}
                                        >
                                            {child.icon && <CtxIcon icon={child.icon} />}
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
                        </div>
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
                    onKeyDown={this._handleKeyDown}
                >
                    <ul role="menu">
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
