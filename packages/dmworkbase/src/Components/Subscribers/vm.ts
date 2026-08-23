import { Channel, Subscriber } from "wukongimjssdk";
import { GroupRole, SubscriberStatus } from "../../Service/Const";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import RouteContext from "../../Service/Context";
import { ChannelSettingRouteData } from "../ChannelSetting/context";
import {
    addCurrentImSubscriberChangeListener,
    getCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime";


export class SubscribersVM extends ProviderListener {
    context:RouteContext<any>
    routeData:ChannelSettingRouteData
    private _subscribers: Subscriber[] = []
    private unsubscribeSubscriberChangeListener?: () => void
    showNum:number = 20


    constructor(context:RouteContext<any>) {
        super()
        this.context = context
        this.routeData = context.routeData()
    }

    didMount(): void {
        const channel = this.routeData.channel
        if (!channel) return
        this.unsubscribeSubscriberChangeListener = addCurrentImSubscriberChangeListener(
            (changedChannel: Channel) => {
                if (!changedChannel?.isEqual?.(channel)) return
                this.reloadSubscribersFromCache()
            }
        )
        this.reloadSubscribersFromCache()
    }

    didUnMount(): void {
        this.unsubscribeSubscriberChangeListener?.()
        this.unsubscribeSubscriberChangeListener = undefined
    }

    private reloadSubscribersFromCache() {
        const channel = this.routeData.channel
        if (!channel) return
        const subscribers = getCurrentImChannelSubscribers<Channel, Subscriber>(channel)
        if (!subscribers.length) return
        for (const subscriber of subscribers) {
            subscriber.channel = channel
            if (subscriber.uid === WKApp.loginInfo.uid) {
                this.routeData.subscriberOfMe = subscriber
            }
        }
        this.routeData.subscriberAll = subscribers
        this.routeData.subscribers = subscribers.filter(
            (subscriber) => subscriber.status === SubscriberStatus.normal
        )
        this.notifyListener()
    }

    get subscribers():Subscriber[] {
        return this.routeData.subscribers
    }

    get subscribersTop():Subscriber[] {

        let showMemberNum = this.shouldShowMemberNum()

        const subscribers = this.routeData.subscribers

        if(subscribers && subscribers.length>0) {
            if(subscribers.length<showMemberNum) {
                return subscribers
            }else {
                return subscribers.slice(0,showMemberNum)
            }
        }
        return subscribers
    }

    shouldShowMemberNum() {
        let showMemberNum = this.showNum

        if(this.showAdd()) {
            showMemberNum-=1
        }
        if(this.showRemove()) {
            showMemberNum-=1
        }
        return showMemberNum
    }

    showAdd() {
        return true
    }

    showRemove() {
        const subscriberOfMe = this.routeData.subscriberOfMe
        let role = GroupRole.normal
        if(subscriberOfMe) {
            role = subscriberOfMe.role
        }
        if(role === GroupRole.owner || role === GroupRole.manager) {
           return true
        }
        // 自助移除（octo-web#1511）：拥有群内 bot 的普通成员也需要一个入口。
        //
        // 不加这条的话该功能在多数群里根本够不着：普通成员唯一能打开成员列表的
        // 路径是「查看全部」，而它只在 subscribers.length > shouldShowMemberNum()
        // （普通成员为 20-1=19）时才渲染 —— 也就是说 19 人以下的群完全没有入口，
        // 后端放行、bot_owned_by_me 也为 true，用户却点不到任何东西。
        //
        // 判据取自成员行的 bot_owned_by_me（严格 true，缺失按 false，与
        // canRemoveChannelSettingSubscriber 同口径）。这里扫的是本地缓存的成员集，
        // 对小群是完整的 —— 而小群正是上面那条路径失效的场景；大群本来就有
        // 「查看全部」兜底，两者互补。
        return this.ownsAnyBotInGroup()
    }

    ownsAnyBotInGroup() {
        const subscribers = this.routeData.subscriberAll || this.routeData.subscribers
        if(!subscribers || subscribers.length === 0) {
            return false
        }
        return subscribers.some(
            (subscriber) => subscriber?.orgData?.bot_owned_by_me === true
        )
    }

    hasMoreSubscribers() {
        let showMemberNum = this.shouldShowMemberNum()
        return this.subscribers.length>showMemberNum
    }

    memberCount() {
        return this.routeData.channelInfo?.orgData?.member_count || this.subscribers.length
    }
}
