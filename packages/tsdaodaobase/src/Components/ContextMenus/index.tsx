import classNames from "classnames";
import React, { HTMLProps } from "react";
import { Component, ReactNode } from "react";

import "./index.css"

export interface ContextMenusProps {
    onContext: (context: ContextMenusContext) => void
    menus?: ContextMenusData[]
}

export interface ContextMenusState {
    contextOrigin: number
    showContextMenus: boolean
}

export interface ContextMenusContext {
    show(event: React.MouseEvent<Element, MouseEvent>): void
    hide(): void
    isShow(): boolean
}

export class ContextMenusData {
    title!: string
    onClick?: () => void
}

export default class ContextMenus extends Component<ContextMenusProps, ContextMenusState> implements ContextMenusContext {
    _gHandleClick!: () => void
    constructor(props: any) {
        super(props)
        this.state = {
            contextOrigin: 0,
            showContextMenus: false,
        }
        this._gHandleClick = this._handleClick.bind(this)
    }
    isShow(): boolean {
        return this.state.showContextMenus
    }
    _handleClick() {
        this.hide()
    }
    _handleScroll() {
        this.hide()
    }
    hide(): void {
        this.setState({
            showContextMenus: false,
        })
    }
    show(event: React.MouseEvent<Element, MouseEvent>): void {
        event.preventDefault();
        if (!this.contextMenusRef) {
            return
        }
        const clickX = event.clientX;
        const clickY = event.clientY;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const rootW = this.contextMenusRef.offsetWidth || 0;
        const rootH = this.contextMenusRef.offsetHeight || 0;

        const showBottom = (screenH - clickY) <= rootH;
        const showLeft = (screenW - clickX) <= rootW


        if (showLeft) {
            this.contextMenusRef.style.left = `${clickX - rootW}px`
        } else {
            this.contextMenusRef.style.left = `${clickX + 5}px`
        }

        if (showBottom) {
            this.contextMenusRef.style.top = `${clickY - rootH}px`
            this.setState({
                contextOrigin: rootH,
                showContextMenus: true,
            })
        } else {
            this.contextMenusRef.style.top = `${clickY}px`
            this.setState({
                contextOrigin: 0,
                showContextMenus: true,
            })
        }
    }

    contextMenusRef!: HTMLDivElement | null

    componentDidMount() {
        const { onContext } = this.props
        if (onContext) {
            onContext(this)
        }
    }

    componentWillUnmount() {
    }

    render(): ReactNode {
        const { showContextMenus, contextOrigin } = this.state
        const { menus } = this.props
        return <>
            <div className={classNames("wk-contextmenus", showContextMenus && "wk-contextmenus-open")} ref={ref => { this.contextMenusRef = ref }} style={{ transformOrigin: `-3px ${contextOrigin}px` }}>
                <ul>
                    {
                        menus && menus.map((m, i) => {
                            return <li key={i} onClick={() => {
                                this.hide()
                                if (m.onClick) {
                                    m.onClick()
                                }
                            }}>{m.title}</li>
                        })
                    }
                </ul>

            </div>
            <div className="wk-contextmenus-mask" style={{ "visibility": showContextMenus ? "visible" : "hidden" }} onClick={() => {
                this._handleClick()
            }}>

            </div>
        </>
    }
}