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
        return false
    }

    hasMoreSubscribers() {
        let showMemberNum = this.shouldShowMemberNum()
        return this.subscribers.length>showMemberNum
    }

    memberCount() {
        return this.routeData.channelInfo?.orgData?.member_count || this.subscribers.length
    }
}
