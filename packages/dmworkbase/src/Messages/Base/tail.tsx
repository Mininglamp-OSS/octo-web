import { MessageStatus } from "wukongimjssdk";
import React from "react";
import { Component, CSSProperties } from "react";
import { MessageWrap } from "../../Service/Model";
import { I18nContext } from "../../i18n";
import { formatMessageTimestamp } from "../../Utils/time";

interface MessageTrailProps {
    message: MessageWrap
    timeStyle?: CSSProperties
    statusStyle?:CSSProperties
}


export default class MessageTrail extends Component<MessageTrailProps> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    getMessageStatusIcon() {
        const { message } = this.props
        if(!message.send) {
            return null
        }
        if(message.status === MessageStatus.Fail) {
            return null
        }
        if(message.status === MessageStatus.Wait) {
            return <i className="icon-message-pending" ></i>
        }
        if(message.readedCount>=1) {
            return <i className="icon-message-read"></i>
        }
        return <i className="icon-message-succeeded"></i>
    }

    render() {
        const { message,timeStyle,statusStyle } = this.props
        return <span className="messageMeta">
            {message.remoteExtra?.isEdit?<span className="messageTime">{this.context.t("base.message.edited")}</span>:null}
            <span className="messageTime" style={timeStyle}> {formatMessageTimestamp(message.timestamp)}</span>
           {message.send?<span className="messageStatus" style={statusStyle}>  {this.getMessageStatusIcon()}</span>:null}
        </span>
    }
}
