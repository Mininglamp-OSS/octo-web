import { Modal } from "@douyinfe/semi-ui"
import { ChannelInfoListener } from "wukongimjssdk"
import { Channel, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContent } from "wukongimjssdk"
import React from "react"
import MergeforwardMessageList from "../../Components/MergeforwardMessageList"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import MessageTrail from "../Base/tail"
import { MessageCell } from "../MessageCell"

import "./index.css"

export default class MergeforwardContent extends MessageContent {
    title!: string
    channelType!: number
    users!: Array<{ uid: string, name: string }>
    msgs!: Array<Message>


    constructor(channelType?: number, users?: Array<{ uid: string, name: string }>, msgs?: Array<Message>) {
        super()
        this.channelType = channelType!
        this.users = users!
        this.msgs = msgs!
    }

    decodeJSON(content: any) {
        this.channelType = content["channel_type"] || 0
        this.users = content["users"] || []
        let msgMaps = content["msgs"]

        let messages = new Array()
        if (msgMaps && msgMaps.length > 0) {
            for (const msgMap of msgMaps) {
                messages.push(this.mapToMessage(msgMap))
            }
        }
        this.msgs = messages
    }
    encodeJSON() {
        let messageMaps = new Array()
        if (this.msgs && this.msgs.length > 0) {
            for (const msg of this.msgs) {
                messageMaps.push(this.messageToMap(msg))
            }
        }
        return { "channel_type": this.channelType || 0, "users": this.users, "msgs": messageMaps }
    }
    get contentType() {
        return MessageContentTypeConst.mergeForward
    }
    get conversationDigest() {
        return "[合并转发]"
    }

    mapToMessage(messageMap: any): Message {
        let message = new Message()
        message.messageID = `${messageMap['message_id']}`
        message.timestamp = messageMap["timestamp"]
        message.fromUID = messageMap["from_uid"]

        let payloadObj = messageMap["payload"]
        let contentType = 0
        if (payloadObj) {
            contentType = payloadObj.type
        }
        let messageContent = WKSDK.shared().getMessageContent(contentType)
        messageContent.decodeJSON(payloadObj)
        message.content = messageContent
        return message
    }

    messageToMap(message: Message): any {

        return { "message_id": message.messageID, "from_uid": message.fromUID ?? "", "timestamp": message.timestamp, payload: message.content.contentObj }
    }
}

 interface MergeforwardCellState {
    showList:boolean
}

export class MergeforwardCell extends MessageCell<any,MergeforwardCellState> {
    channelInfoListener!:ChannelInfoListener

    constructor(props:any) {
        super(props)
        this.state = {
            showList:false,
        }
    }

    getTitle(content: MergeforwardContent) {
        if (content.channelType === ChannelTypeGroup) {
            return "群的聊天记录"
        }

        const names = content.users.map((v) => {
            return v.name
        })

        return `${names.join("、")}的聊天记录`

    }

    getMsgListUI(msgs: Message[]) {
        if (!msgs || msgs.length === 0) {
            return
        }
        let newMsgs = new Array()
        if(msgs.length<=4) {
            newMsgs = msgs
        }else {
            newMsgs = msgs.slice(0,4)
        }
        return newMsgs.map((m: Message) => {
            const channel = new Channel(m.fromUID, ChannelTypePerson)
            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
            let name = ""
            if (channelInfo) {
                name = channelInfo.title
            } else {
                WKSDK.shared().channelManager.fetchChannelInfo(channel)
            }
            return <div key={m.messageID} className="wk-mergeforwards-content-item">{name}： {m.content.conversationDigest}</div>
        })
    }

    componentDidMount() {
        this.channelInfoListener = ()=>{
            this.setState({})
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }
    componentWillUnmount() {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    render() {
        const { message,context } = this.props
        const { showList } = this.state
        const content = message.content as MergeforwardContent
        return <MessageBase hiddeBubble={true} message={message} context={context}><div className="wk-mergeforwards">
            <div className="wk-mergeforwards-content" onClick={()=>{
                this.setState({
                    showList: true,
                })
            }}>
                <div className="wk-mergeforwards-content-title">
                    {this.getTitle(content)}
                </div>
                <div className="wk-mergeforwards-content-items">
                    {
                        this.getMsgListUI(content.msgs)
                    }
                </div>
                <div className="wk-mergeforwards-content-line">

                </div>
                <div className="wk-mergeforwards-content-tip">
                    <p>聊天记录</p>
                    <p> <MessageTrail message={message} timeStyle={{ color: "#999" }} /></p>
                </div>
            </div>
        </div>
        <Modal className="wk-base-modal"  visible={showList} footer={null} onCancel={()=>{
            this.setState({
                showList: false,
            })
        }}>
            <MergeforwardMessageList mergeforwardContent={content}></MergeforwardMessageList>
        </Modal>
        </MessageBase>
    }
}