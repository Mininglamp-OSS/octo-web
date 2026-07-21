import { Channel, ChannelTypePerson, ChannelTypeGroup, WKSDK } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import { BubblePosition, MessageWrap } from "../../Service/Model";
import AiBadge from "../../Components/AiBadge";
import WebhookBadge from "../../Components/WebhookBadge";
import WKApp from "../../App";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { resolveWebhookRowDisplay, webhookFromOfMessage } from "../../Service/IncomingWebhook";
import { getImChannelInfo } from "../../im-runtime/channelRuntime";

const titleColors = ["#8C8DFF", "#7983C2", "#6D8DDE", "#5979F0", "#6695DF", "#8F7AC5",
    "#9D77A5", "#8A64D0", "#AA66C3", "#A75C96", "#C8697D", "#B74D62",
    "#BD637C", "#B3798E", "#9B6D77", "#B87F7F", "#C5595A", "#AA4848",
    "#B0665E", "#B76753", "#BB5334", "#C97B46", "#BE6C2C", "#CB7F40",
    "#A47758", "#B69370", "#A49373", "#AA8A46", "#AA8220", "#76A048",
    "#9CAD23", "#A19431", "#AA9100", "#A09555", "#C49B4B", "#5FB05F",
    "#6AB48F", "#71B15C", "#B3B357", "#A3B561", "#909F45", "#93B289",
    "#3D98D0", "#429AB6", "#4EABAA", "#6BC0CE", "#64B5D9", "#3E9CCB",
    "#2887C4", "#52A98B"];

    export const hascode =(str:string) => {
        let hash = 0
        if(hash === 0 && str.length>0) {
            for(let i=0;i<str.length;i++) {
                hash = hash * 31 + str.charCodeAt(i)
            }
        }
        return hash
    }

    export const getTitleColor = (title:string="") => {
        const v = hascode(title)
        return titleColors[v%titleColors.length]
    }


interface MessageHeadProps {
    message: MessageWrap
}

export default class MessageHead extends Component<MessageHeadProps> {

    needTitle() {
        const { message } = this.props
        if(message.send) {
            return false
        }
        if(message.bubblePosition === BubblePosition.first || message.bubblePosition === BubblePosition.single) {
            return true
        }
        return false
    }

    render() {
        const { message } = this.props
        // 群入站 Webhook 消息：发送者名读 payload from 元信息，
        // 不走 ChannelInfo（iwh_* 不是真实用户，必落空）
        const webhookFrom = webhookFromOfMessage(message)
        if (webhookFrom) {
            const { senderName: name, showBadge } = resolveWebhookRowDisplay(webhookFrom)
            return <>
                {this.needTitle() ? (
                    <div className="textTitle" style={{ color: getTitleColor(name) }}>
                        <div className="textTitle-name-row">
                            <span>{name}</span>
                            {showBadge && <WebhookBadge />}
                        </div>
                    </div>
                ) : null}
            </>
        }
        const channelInfo = getImChannelInfo(WKSDK.shared(), new Channel(message.fromUID, ChannelTypePerson))
        const isGroupMsg = message.channel.channelType === ChannelTypeGroup
        const isBot = channelInfo?.orgData?.robot === 1
        // 外部群成员来源标记：
        // 消息级 home_space_id/home_space_name 与 is_external/source_space_name
        // 由 Convert.toMessage 从 /message/channel/sync 响应透传。优先新字段，
        // 缺失时回落到 channelInfo.orgData 上的对应字段（向后兼容）。
        const viewerSpaceId = WKApp.shared.currentSpaceId
        // 1) msg-level：新字段为主，旧字段降级
        const msgRes = resolveExternalForViewer({
            homeSpaceId: message.fromHomeSpaceId,
            homeSpaceName: message.fromHomeSpaceName,
            isExternalLegacy: message.fromIsExternal ? 1 : 0,
            sourceSpaceNameLegacy: message.fromSourceSpaceName,
            viewerSpaceId,
        })
        const hasMsgLevel = !!message.fromHomeSpaceId ||
            (message.fromIsExternal && !!message.fromSourceSpaceName)
        // 2) org-level 回落：仅当 msg-level 完全缺失时使用 channelInfo.orgData
        const orgHomeSpaceId = channelInfo?.orgData?.home_space_id as string | undefined
        const orgHomeSpaceName = channelInfo?.orgData?.home_space_name as string | undefined
        const orgRes = isGroupMsg
            ? resolveExternalForViewer({
                homeSpaceId: orgHomeSpaceId,
                homeSpaceName: orgHomeSpaceName,
                isExternalLegacy: channelInfo?.orgData?.is_external,
                sourceSpaceNameLegacy: channelInfo?.orgData?.source_space_name,
                viewerSpaceId,
            })
            : { isExternal: false, sourceSpaceName: "" }
        const isExternalMember = hasMsgLevel ? msgRes.isExternal : orgRes.isExternal
        const sourceSpaceName = hasMsgLevel ? msgRes.sourceSpaceName : orgRes.sourceSpaceName
        return <>
           {
                this.needTitle()?( <div className="textTitle" style={{color:getTitleColor(channelInfo?.orgData?.displayName)}}>
                <div className="textTitle-name-row">
                    <span>{channelInfo?.orgData?.displayName}</span>
                    {/* 昵称后「@SpaceName」后缀（企微风格），按当前查看 Space 相对渲染 */}
                    {isExternalMember && sourceSpaceName && (
                        <span className="wk-msg-head-space" title={`@${sourceSpaceName}`}>
                            @{sourceSpaceName}
                        </span>
                    )}
                    {isBot && <AiBadge size="small" />}
                </div>
            </div>):null
           }
        </>
    }
}
