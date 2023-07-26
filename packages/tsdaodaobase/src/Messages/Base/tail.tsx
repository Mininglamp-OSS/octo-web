import { MessageStatus } from "wukongimjssdk";
import moment from "moment";
import React from "react";
import { Component, CSSProperties } from "react";
import { MessageWrap } from "../../Service/Model";

interface MessageTrailProps {
    message: MessageWrap
    timeStyle?: CSSProperties
    statusStyle?:CSSProperties
}


export default class MessageTrail extends Component<MessageTrailProps> {

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
            <span className="messageTime" style={timeStyle}> {moment(message.timestamp * 1000).format('HH:mm')}</span>
           {message.send?<span className="messageStatus" style={statusStyle}>  {this.getMessageStatusIcon()}</span>:null}
        </span>
    }
}