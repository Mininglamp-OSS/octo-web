import { Channel, ChannelInfo, Subscriber } from "wukongimjssdk";
import { GroupRole } from "../../Service/Const";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import ConversationContext from "../Conversation/context";


export class ChannelSettingRouteData {
     channel!:Channel
     channelInfo?:ChannelInfo
     subscribers!:Subscriber[] // 成员列表（所有状态为正常状态的成员）
     subscriberOfMe?:Subscriber
     subscriberAll!:Subscriber[] //成员列表，所有状态的成员，比如：黑名单内的成员
     refresh!:()=>void // 刷新
     conversationContext?:ConversationContext

     // 我是否是管理者或创建者
     get isManagerOrCreatorOfMe() {
        if (this.subscriberOfMe?.role === GroupRole.manager || this.subscriberOfMe?.role === GroupRole.owner) {
            return true
        }
        // Fallback: if subscriber data is unavailable (e.g. IM channel not yet created
        // after weak-network group creation), check role from channelInfo.orgData which
        // is populated from the server-side GroupResp.
        if (!this.subscriberOfMe && this.channelInfo?.orgData?.role != null) {
            const role = this.channelInfo.orgData.role as number
            if (role === GroupRole.owner || role === GroupRole.manager) {
                return true
            }
        }
        return false
     }

}

// export interface ChannelSettingContext extends RouteContext{
//      channel(): Channel
//      channelInfo(): ChannelInfo 
//      subscribers(): Subscriber[] // 订阅者列表
//      subscriberOfMe(): Subscriber | undefined // 当前用户订阅者信息
    
// }