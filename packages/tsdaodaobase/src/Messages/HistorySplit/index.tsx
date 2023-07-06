import { MessageContent } from "wukongimjssdk/lib/model";
import React from "react";
import { MessageContentTypeConst } from "../../Service/Const";
import { MessageCell } from "../MessageCell";

import  './index.css'


export class HistorySplitContent extends MessageContent {

    public get contentType() {
        return MessageContentTypeConst.historySplit
    }
}

export class HistorySplitCell extends MessageCell {

    render() {
        return <div className="wk-message-split-box">
           <div className="wk-message-split-line1"></div>
           <div className="wk-message-split-content">以上为历史消息</div>
           <div className="wk-message-split-line2"></div>
        </div>
    }
}