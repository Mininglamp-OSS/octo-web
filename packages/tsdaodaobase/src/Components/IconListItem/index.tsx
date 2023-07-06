import { Badge } from "@douyinfe/semi-ui";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css"

export interface IconListItemProps {
    icon: string
    title: string
    backgroudColor?: string
    onClick?: () => void
    badge?: number
}

export default class IconListItem extends Component<IconListItemProps> {


    render(): ReactNode {
        const { icon, title, backgroudColor, onClick, badge } = this.props
        return <div className="wk-iconlistitem" style={{ "backgroundColor": backgroudColor }} onClick={onClick}>
            <div className="wk-iconlistitem-content">
                <div className="wk-iconlistitem-content-icon">
                    <img src={icon}></img>
                </div>
                <div className="wk-iconlistitem-content-title">
                    {title}
                </div>
                {
                    badge && badge > 0 ? <div className="wk-iconlistitem-content-badge">
                        <Badge count={1} type="danger"></Badge>
                    </div> : undefined
                }
            </div>
        </div>
    }
}