import { Channel, ChannelInfo, Subscriber } from "wukongimjssdk/lib/sdk";
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
        return  this.subscriberOfMe?.role === GroupRole.manager || this.subscriberOfMe?.role === GroupRole.owner
     }

}

// export interface ChannelSettingContext extends RouteContext{
//      channel(): Channel
//      channelInfo(): ChannelInfo 
//      subscribers(): Subscriber[] // 订阅者列表
//      subscriberOfMe(): Subscriber | undefined // 当前用户订阅者信息
    
// }