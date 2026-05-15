import WKModal from "../../Components/WKModal"
import { Channel, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContent } from "wukongimjssdk"
import React from "react"
import MergeforwardMessageList from "../../Components/MergeforwardMessageList"
import { MessageContentTypeConst } from "../../Service/Const"
import { applyMsgLevelExternalFields } from "../../Service/Convert"
import MessageBase from "../Base"
import MessageTrail from "../Base/tail"
import { MessageCell } from "../MessageCell"
import MessageRow from "../../ui/message/MessageRow"
import MergeforwardCard from "../../ui/message/MergeforwardCard"
import { getMergeforwardMessageUI } from "../../bridge/message/useMergeforwardMessageUI"

import "./index.css"

// users 新增外部来源字段。后端在合并转发归档时填充，前端透传即可。
export interface MergeforwardUser {
    uid: string
    name: string
    /** 1=外部群成员；0/undefined=非外部 */
    is_external?: number
    /** 外部成员所属 Space 名称，仅在 is_external=1 时有意义 */
    source_space_name?: string
}

export default class MergeforwardContent extends MessageContent {
    title!: string
    channelType!: number
    users!: Array<MergeforwardUser>
    msgs!: Array<Message>
    private static decodeDepth = 0

    constructor(channelType?: number, users?: Array<MergeforwardUser>, msgs?: Array<Message>) {
        super()
        this.channelType = channelType!
        this.users = users!
        this.msgs = msgs!
    }

    decodeJSON(content: any) {
        // 增加递归深度
        MergeforwardContent.decodeDepth++

        // 深度超过 8 时，停止处理，避免栈溢出
        if (MergeforwardContent.decodeDepth > 8) {
            this.channelType = content["channel_type"] || 0
            this.users = content["users"] || []
            this.msgs = []
            MergeforwardContent.decodeDepth--
            return
        }

        this.channelType = content["channel_type"] || 0
        const rawUsers: Array<MergeforwardUser> = content["users"] || []
        const seen = new Set<string>()
        this.users = rawUsers
            .filter(u => {
                if (seen.has(u.uid)) return false
                seen.add(u.uid)
                return true
            })
            .map(u => {
                // 透传外部来源字段；仅保留有效值避免噪音
                const mapped: MergeforwardUser = { uid: u.uid, name: u.name }
                if (u.is_external === 1 || u.is_external === 0) {
                    mapped.is_external = u.is_external
                }
                if (typeof u.source_space_name === "string" && u.source_space_name !== "") {
                    mapped.source_space_name = u.source_space_name
                }
                return mapped
            })
        let msgMaps = content["msgs"]

        let messages = new Array()
        if (msgMaps && msgMaps.length > 0) {
            for (const msgMap of msgMaps) {
                messages.push(this.mapToMessage(msgMap))
            }
        }
        this.msgs = messages

        // 恢复递归深度
        MergeforwardContent.decodeDepth--
    }
    encodeJSON() {
        let messageMaps = new Array()
        if (this.msgs && this.msgs.length > 0) {
            for (const msg of this.msgs) {
                messageMaps.push(this.messageToMap(msg))
            }
        }
        // users 原样透传，保留 is_external / source_space_name
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
        if (!payloadObj) {
            payloadObj = {}
        }
        let contentType = 0
        if (payloadObj) {
            contentType = payloadObj.type
        }
        let messageContent = WKSDK.shared().getMessageContent(contentType)
        const payloadData = new TextEncoder().encode(JSON.stringify(payloadObj))
        messageContent.decode(payloadData)
        message.content = messageContent

        applyMsgLevelExternalFields(message, messageMap)

        return message
    }

    messageToMap(message: Message): any {
        // Use contentObj if available, otherwise fall back to encodeJSON()
        let payload = message.content.contentObj
        if (!payload) {
            payload = message.content.encodeJSON()
            payload.type = message.content.contentType
        }
        return { "message_id": message.messageID, "from_uid": message.fromUID ?? "", "timestamp": message.timestamp, payload: payload }
    }
}

 interface MergeforwardCellState {
    showList:boolean
}

export class MergeforwardCell extends MessageCell<any,MergeforwardCellState> {

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
        super.componentDidMount()
    }
    componentWillUnmount() {
        super.componentWillUnmount()
    }

    render() {
        const { message, context } = this.props
        const { showList } = this.state
        const content = message.content as MergeforwardContent

        // TODO: 后续改成 feature flag
        const useNewUI = true

        // 新 UI 实现
        if (useNewUI) {
            const uiProps = getMergeforwardMessageUI(message, {
                showCheckbox: context.editOn(),
                isSelected: !!message.checked,
                onSelect: (selected) => context.checkeMessage(message.message, selected),
            })
            return (
                <>
                    <MessageRow
                        {...uiProps.row}
                        onContextMenu={(event) => context.showContextMenus(message, event)}
                        isActive={context.isContextMenuOpen(message.message)}
                        onClick={context.editOn() ? () => context.checkeMessage(message.message, !message.checked) : undefined}
                        onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
                        onSenderNameClick={() => context.showUser(message.fromUID)}
                    >
                        <MergeforwardCard
                            {...uiProps.card}
                            onClick={context.editOn() ? undefined : () => this.setState({ showList: true })}
                        />
                    </MessageRow>
                    <WKModal
                        className="wk-base-modal wk-mergeforward-modal"
                        title={this.getTitle(content)}
                        visible={showList}
                        onCancel={() => this.setState({ showList: false })}
                        footer={null}
                    >
                        <MergeforwardMessageList
                            mergeforwardContent={content}
                            onClose={() => this.setState({ showList: false })}
                        />
                    </WKModal>
                </>
            )
        }

        // 旧 UI 实现（保持向后兼容）
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
        <WKModal className="wk-base-modal wk-mergeforward-modal" title={this.getTitle(content)} visible={showList} onCancel={()=>{
            this.setState({ showList: false })
        }}>
            <MergeforwardMessageList
                mergeforwardContent={content}
                onClose={() => this.setState({ showList: false })}
            />
        </WKModal>
        </MessageBase>
    }
}
