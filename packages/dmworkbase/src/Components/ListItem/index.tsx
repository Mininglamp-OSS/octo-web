import { Switch } from "@octo/ui";
import React, { CSSProperties } from "react";
import { Component } from "react";
import { I18nContext } from "../../i18n";
import "./index.css"

export interface ListItemProps {
    style: CSSProperties
    title: string
    subTitle?: React.ReactNode
    onClick?: () => void
}

export class ListItem extends Component<ListItemProps>{

    render() {
        const { style, title, subTitle, onClick } = this.props
        const clickable = typeof onClick === "function"
        const titleAttr = typeof subTitle === "string" ? subTitle : undefined
        return <div className={`wk-list-item ${clickable ? "wk-list-item-ripple" : "wk-list-item-static"}`} style={style} title={titleAttr} onClick={() => {
            if (clickable) {
                onClick()
            }
        }}>
            <div className="wk-list-item-title">
                {title}
            </div>
            <div className="wk-list-item-subtitle">
                {subTitle}
            </div>
            {/* <div className="wk-list-item-arrow">
                <img src={require("./assets/arrow_right.png)}></img>
            </div> */}
        </div>
    }
}

export class ListItemMuliteLine extends Component<ListItemProps>{
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    hasSubtitle() {
        const { subTitle } = this.props
        if (typeof subTitle === "string") {
            return subTitle !== ""
        }
        return subTitle != null
    }
    render() {
        const { style, title, subTitle, onClick } = this.props
        return <div className="wk-list-item wk-list-item-ripple" style={{ "display": this.hasSubtitle() ? "block" : undefined }} onClick={() => {
            if (onClick) {
                onClick()
            }
        }}>
            <div className="wk-list-item-title">
                {title}
            </div>

            {
                this.hasSubtitle() ? <div className="wk-list-item-subtitle-muliteline">
                    {subTitle}
                </div> : <div className="wk-list-item-subtitle wk-list-item-subtitle-oneline">
                    {this.context.t("base.common.notSet")}
                </div>
            }


        </div>
    }
}

export interface ListItemSwitchProps extends ListItemProps {
    checked?: boolean
    onCheck?: (v: boolean,ctx?:ListItemSwitchContext) => void
}

export interface ListItemSwitchState {
    loading:boolean
}

export interface ListItemSwitchContext {
    loading: boolean
}

export class ListItemSwitch extends Component<ListItemSwitchProps, ListItemSwitchState> implements ListItemSwitchContext {
    constructor(props: any) {
        super(props)
        this.state = {
            loading: false,
        }
    }
    set loading(v: boolean) {
        this.setState({
            loading: v,
        })
    }

    get loading() {
        return this.state.loading
    }

    render() {
        const { style, title, subTitle, checked, onCheck } = this.props
        const { loading } = this.state
        return <div className="wk-list-item wk-list-item-ripple" style={style} onClick={() => {
            if (onCheck) {
                onCheck(!checked,this)
            }
        }}>
            {subTitle ? <div className="wk-list-item-switch-copy">
                <div className="wk-list-item-title">
                    {title}
                </div>
                <div className="wk-list-item-switch-subtitle">
                    {subTitle}
                </div>
            </div> : <div className="wk-list-item-title">
                {title}
            </div>}
            <div className="wk-list-item-action">
                <Switch checked={checked} loading={loading}></Switch>
            </div>
        </div>
    }
}

export interface ListItemIconProps extends ListItemProps {
    icon: JSX.Element
}
export class ListItemIcon extends Component<ListItemIconProps> {

    render() {
        const { style, title, icon, onClick } = this.props
        return <div className="wk-list-item wk-list-item-ripple" style={style} onClick={() => {
            if (onClick) {
                onClick()
            }
        }}>
            <div className="wk-list-item-title">
                {title}
            </div>
            <div className="wk-list-item-subtitle">
                {icon}
            </div>
        </div>
    }
}

export enum ListItemButtonType {
    default,
    warn
}

export interface ListItemButtonProps extends ListItemProps {
    type?: ListItemButtonType
}

export class ListItemButton extends Component<ListItemButtonProps> {
    render() {
        const { style, title, type, onClick } = this.props
        return <div className="wk-list-item wk-list-item-ripple" style={{ "justifyContent": "center" }} onClick={() => {
            if (onClick) {
                onClick()
            }
        }}>
            <div className="wk-list-item-title" style={{ "color": type === ListItemButtonType.warn ? "red" : undefined }}>
                {title}
            </div>
        </div>
    }
}

export interface ListItemTipProps extends ListItemProps {
    tip:string | React.ReactNode
}
export class ListItemTip extends Component<ListItemTipProps> {

    render(): React.ReactNode {
        const { tip } = this.props
        return <div className="wk-list-item-tip">
            {tip}
        </div>
    }
}
