import { Channel, ChannelTypePerson, MessageContent } from "wukongimjssdk/lib/sdk"
import React from "react"
import WKBase, { WKBaseContext } from "../../Components/WKBase"
import WKApp from "../../App"
import MessageBase from "../Base"
import MessageTrail from "../Base/tail"
import { MessageBaseCellProps, MessageCell } from "../MessageCell"

import "./index.css"
import { MessageContentTypeConst } from "../../Service/Const"


export class Card extends MessageContent {
    name!: string
    uid!: string
    vercode!: string
    _avatar!: string

    get avatar() {
        if (this._avatar === "") {
            return WKApp.shared.avatarChannel(new Channel(this.uid, ChannelTypePerson))
        }
        return this._avatar
    }

    decodeJSON(content: any) {
        this.name = content["name"] || ""
        this.uid = content["uid"] || ""
        this.vercode = content["vercode"] || ""
        this._avatar = content["avatar"] || ""
    }
    encodeJSON(): any {
        return {name:this.name||"",uid:this.uid,vercode:this.vercode,avatar:this._avatar||""}
    }
    get contentType() {
        return MessageContentTypeConst.card
    }

    get conversationDigest() {

        return "[名片]"
    }
}


interface CardCellState {
    showUser: boolean
}

export class CardCell extends MessageCell<MessageBaseCellProps, CardCellState> {
    baseContext!:WKBaseContext
    constructor(props: any) {
        super(props)
        this.state = {
            showUser: false,
        }
    }
    render() {
        const { message, context } = this.props
        const content = message.content as Card
        const { showUser } = this.state

        return <WKBase onContext={(ctx)=>{
            this.baseContext = ctx
        }}>
            <MessageBase hiddeBubble={true} message={message} context={context}>
                <div className="wk-message-card">
                    <div className="wk-message-card-content" onClick={() => {
                        WKApp.shared.baseContext.showUserInfo(content.uid,context.channel(),content.vercode)
                    }}>
                        <div>
                            <img src={WKApp.shared.avatarUser(content.uid)} style={{ width: "64px", height: "64px", borderRadius: "50%" }} alt="" />
                        </div>
                        <div className="wk-message-card-content-name">
                            {content.name}
                        </div>
                    </div>
                    <div className="wk-message-card-bottom">
                        <div className="wk-message-card-bottom-flag">个人名片</div>
                        <div className="wk-message-card-bottom-time">
                            <MessageTrail message={message} timeStyle={{ color: "#999" }} />
                        </div>
                    </div>
                    {/* <UserInfoModal onCancel={() => {
                    this.setState({
                        showUser: false,
                    })
                }} show={showUser} uid={content.uid} /> */}
                </div>
            </MessageBase>
        </WKBase>
    }
}