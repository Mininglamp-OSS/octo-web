import React from "react";
import { Component, ReactNode } from "react";
import WKApp from "../../App";

import "./index.css"


export class SmallTableEditItem {
    onAction?: () => void
    id!: string
    icon!: string
    name!: string
    showAction?: boolean
}

export interface SmallTableEditProps {
    items: SmallTableEditItem[]
    addTitle?:string
    onAdd?: () => void
}

export default class SmallTableEdit extends Component<SmallTableEditProps> {

    render(): ReactNode {
        const { items, onAdd,addTitle } = this.props
        return <div className="wk-smalltableedit">
            <div className="wk-smalltableedit-content">
                <div className="wk-smalltableedit-content-items">
                    {
                        items.map((item) => {
                            return <div className="wk-smalltableedit-content-item" key={item.id}>
                                <div className="wk-smalltableedit-content-item-avatar">
                                    <img src={item.icon}></img>
                                </div>
                                <div className="wk-smalltableedit-content-item-name wk-text-oneline">
                                    {item.name}
                                </div>
                                {
                                    item.showAction ? <div className="wk-smalltableedit-content-item-action" onClick={() => {
                                        if (item.onAction) {
                                            item.onAction()
                                        }
                                    }}>
                                        <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fillOpacity="0.01" /><path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="red" strokeWidth="3" strokeLinejoin="round" /><path d="M16 24L32 24" stroke="red" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </div> : undefined
                                }
                            </div>
                        })
                    }
                </div>
                <div className="wk-smalltableedit-content-item" style={{ "cursor": "pointer" }} onClick={() => {
                    if (onAdd) {
                        onAdd()
                    }
                }}>
                    <div className="wk-smalltableedit-content-item-avatar">
                        <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" fill="white" fillOpacity="0.01" /><path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke={WKApp.config.themeColor} strokeWidth="3" strokeLinejoin="round" /><path d="M24 16V32" stroke="#999" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M16 24L32 24" stroke={WKApp.config.themeColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <div className="wk-smalltableedit-content-item-name wk-text-oneline">
                        {
                            addTitle?addTitle:"添加"
                        }
                    </div>
                </div>
            </div>
        </div>
    }
}