import React, { Component } from "react";
import ConversationContext from "../Components/Conversation/context";
import { MessageWrap } from "../Service/Model";


export interface MessageBaseCellProps {
    message: MessageWrap
    context: ConversationContext
}

class MessageBaseCellPropsImp implements MessageBaseCellProps {
    message!: MessageWrap;
    context!: ConversationContext

}
export class MessageBaseCell<P extends MessageBaseCellProps = MessageBaseCellPropsImp, S = {}> extends Component<P, S> {


}

export class MessageCell<P extends MessageBaseCellProps = MessageBaseCellPropsImp, S = {}> extends MessageBaseCell<P, S> {

    render() {
        return <div>MessageCell</div>
    }
}