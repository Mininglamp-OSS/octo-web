import { Switch } from "@douyinfe/semi-ui";
import React, { CSSProperties } from "react";
import { Component } from "react";
import "./index.css"

export interface ListItemProps {
    style: CSSProperties
    title: string
    subTitle?: string
    onClick: () => void
}

export class ListItem extends Component<ListItemProps>{

    render() {
        const { style, title, subTitle, onClick } = this.props
        return <div className="wk-list-item wk-list-item-ripple" style={style} title={subTitle} onClick={() => {
            if (onClick) {
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
                <img src={require("./assets/arrow_right.png").default}></img>
            </div> */}
        </div>
    }
}

export class ListItemMuliteLine extends Component<ListItemProps>{

    hasSubtitle() {
        const { subTitle } = this.props
        return subTitle && subTitle !== ""
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
                    未设置
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
        const { style, title, checked, onCheck } = this.props
        const { loading } = this.state
        return <div className="wk-list-item wk-list-item-ripple" style={style} onClick={() => {
            if (onCheck) {
                onCheck(!checked,this)
            }
        }}>
            <div className="wk-list-item-title">
                {title}
            </div>
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
