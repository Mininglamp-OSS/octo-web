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
// 零依赖叶子模块：入口可见性与行可见性共用同一判据（octo-web#1511）。
// 不从 features/channelSetting/channelSettingMemberSection 引 —— 那会成环。
import { canRemoveChannelSettingSubscriber } from "../../features/channelSetting/memberRemovalPermission";
import { findRemovableGroupMember } from "../../bridge/channelSetting/memberRemovalRead";


export class SubscribersVM extends ProviderListener {
    context:RouteContext<any>
    routeData:ChannelSettingRouteData
    private _subscribers: Subscriber[] = []
    private unsubscribeSubscriberChangeListener?: () => void
    showNum:number = 20
    removalEntryError = false
    private removalEntryFound = false
    private removalEntryScope = ""
    private removalProbe?: AbortController
    private removalRefreshTimer?: ReturnType<typeof setTimeout>
    private isMounted = false


    constructor(context:RouteContext<any>) {
        super()
        this.context = context
        this.routeData = context.routeData()
    }

    didMount(): void {
        this.isMounted = true
        const channel = this.routeData.channel
        if (!channel) return
        this.unsubscribeSubscriberChangeListener = addCurrentImSubscriberChangeListener(
            (changedChannel: Channel) => {
                if (!changedChannel?.isEqual?.(channel)) return
                this.scheduleRemovalEntryRefresh()
                this.reloadSubscribersFromCache()
            }
        )
        this.reloadSubscribersFromCache()
        void this.refreshRemovalEntry()
    }

    didUnMount(): void {
        this.isMounted = false
        this.removalProbe?.abort()
        clearTimeout(this.removalRefreshTimer)
        this.unsubscribeSubscriberChangeListener?.()
        this.unsubscribeSubscriberChangeListener = undefined
    }

    private reloadSubscribersFromCache() {
        const channel = this.routeData.channel
        if (!channel) return
        const subscribers = getCurrentImChannelSubscribers<Channel, Subscriber>(channel)
        if (!subscribers.length) {
            this.notifyListener()
            return
        }
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
        // Keep the same strict row predicate. A local positive is sufficient;
        // a cache miss is not a group-wide negative (super-groups cache a prefix).
        return this.ownsAnyRemovableBotInGroup(role) ||
            (this.removalEntryScope === this.entryScope() && this.removalEntryFound)
    }

    private entryScope() {
        return JSON.stringify([
            this.routeData.channel?.getChannelKey(),
            this.routeData.subscriberOfMe?.uid || WKApp.loginInfo.uid,
            this.routeData.subscriberOfMe?.role ?? GroupRole.normal,
            WKApp.loginInfo.uid,
            WKApp.shared?.currentSpaceId,
        ])
    }

    private scheduleRemovalEntryRefresh() {
        this.removalProbe?.abort()
        this.removalEntryFound = false
        this.removalEntryError = false
        clearTimeout(this.removalRefreshTimer)
        // Coalesce bursts of IM cache updates without scanning on render.
        this.removalRefreshTimer = setTimeout(() => void this.refreshRemovalEntry(), 200)
    }

    refreshRemovalEntry = async () => {
        if (!this.isMounted) return
        clearTimeout(this.removalRefreshTimer)
        this.removalProbe?.abort()
        const controller = new AbortController()
        this.removalProbe = controller
        this.removalEntryScope = this.entryScope()
        this.removalEntryFound = false
        this.removalEntryError = false
        const role = this.routeData.subscriberOfMe?.role ?? GroupRole.normal
        const viewerUid = this.routeData.subscriberOfMe?.uid || WKApp.loginInfo.uid
        const channel = this.routeData.channel
        if (!channel || !viewerUid || role === GroupRole.owner ||
            role === GroupRole.manager || this.ownsAnyRemovableBotInGroup(role)) return
        const scope = this.removalEntryScope
        const current = () => this.isMounted && !controller.signal.aborted && scope === this.entryScope()
        try {
            const found = await findRemovableGroupMember(channel, viewerUid, role, controller.signal)
            if (current()) this.removalEntryFound = found
        } catch {
            if (current()) this.removalEntryError = true
        } finally {
            if (current()) this.notifyListener()
        }
    }

    ownsAnyRemovableBotInGroup(viewerRole: number) {
        const subscribers = this.routeData.subscriberAll || this.routeData.subscribers
        if(!subscribers || subscribers.length === 0) {
            return false
        }
        const viewerUid = this.routeData.subscriberOfMe?.uid || WKApp.loginInfo.uid
        return subscribers.some((subscriber) =>
            canRemoveChannelSettingSubscriber({ viewerUid, viewerRole, subscriber })
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
