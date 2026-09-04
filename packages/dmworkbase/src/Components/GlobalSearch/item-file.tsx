import React from "react";
import { Component, ReactNode } from "react";
import "./item-file.css"
import { sanitizeHighlight } from "./sanitize"
import FileHelper from "../../Utils/filehelper";
import { getTimeStringAutoShort2 } from "../../Utils/time";
import { fileIconSrc } from "./searchFileIcon";
interface ItemFileProps {
    message: any;
    sender?: string;
    onClick?: () => void;
}

export default class ItemFile extends Component<ItemFileProps> {

    render(): ReactNode {
        const file = this.props.message.payload;
        const channel = this.props.message.channel;
        const realName = file.name?.replaceAll("<mark>", "").replaceAll("</mark>", "");
        const iconSrc = fileIconSrc(realName ?? "");
        return <div className="wk-item-file" onClick={() => {
            if (this.props.onClick) {
                this.props.onClick()
            }
        }}>
            <div className="wk-item-file-icon">
                <img alt="" src={iconSrc} style={{ width: '48px', height: '48px' }} />
            </div>
            <div className="wk-item-file-name" dangerouslySetInnerHTML={{ __html: sanitizeHighlight(file.name) }}></div>
            <div className="wk-item-file-desc">
                <div className="wk-item-file-sender">{this.props.sender}</div><div className="wk-item-file-line" />
                <div className="wk-item-file-recv">{channel.channel_name}</div><div className="wk-item-file-line" />
                <div className="wk-item-file-size">{FileHelper.getFileSizeFormat(file.size || 0)}</div><div className="wk-item-file-line" />
                <div className="wk-item-file-time">{getTimeStringAutoShort2(this.props.message.timestamp * 1000, true)}</div>
            </div>
        </div>
    }
}