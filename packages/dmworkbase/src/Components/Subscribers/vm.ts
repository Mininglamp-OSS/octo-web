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
import { findRemovableGroupMember, newMemberEntryCursor } from "../../bridge/channelSetting/memberRemovalRead";
import { ChannelMemberService } from "../../Service/ChannelMemberService";


export class SubscribersVM extends ProviderListener {
    context:RouteContext<any>
    routeData:ChannelSettingRouteData
    private _subscribers: Subscriber[] = []
    private unsubscribeSubscriberChangeListener?: () => void
    showNum:number = 20
    removalEntryStatus: "idle" | "checking" | "found" | "none" | "partial" | "error" = "idle"
    private removalCursor = newMemberEntryCursor()
    private removalEntryScope = ""
    private removalProbe?: AbortController
    private isMounted = false
    private active: boolean
    private entryDirty = false


    constructor(context:RouteContext<any>, active = true) {
        super()
        this.context = context
        this.routeData = context.routeData()
        this.active = active
    }

    didMount(): void {
        this.isMounted = true
        const channel = this.routeData.channel
        if (!channel) return
        this.unsubscribeSubscriberChangeListener = addCurrentImSubscriberChangeListener(
            (changedChannel: Channel) => {
                if (!changedChannel?.isEqual?.(channel)) return
                // Invalidate evidence, but never restart a whole scan per event.
                this.invalidateRemovalEntry()
                this.reloadSubscribersFromCache()
            }
        )
        this.reloadSubscribersFromCache()
        if (this.active) void this.refreshRemovalEntry()
    }

    didUnMount(): void {
        this.isMounted = false
        this.removalProbe?.abort()
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
        let role: number | undefined
        if(subscriberOfMe?.uid === WKApp.loginInfo.uid) {
            role = subscriberOfMe.role
        }
        if(role === GroupRole.owner || role === GroupRole.manager) {
           return true
        }
        // Keep the same strict row predicate. A local positive is sufficient;
        // a cache miss is not a group-wide negative (super-groups cache a prefix).
        return (role !== undefined && this.ownsAnyRemovableBotInGroup(role)) ||
            (this.removalEntryScope === this.entryScope() && this.removalEntryStatus === "found")
    }

    private entryScope() {
        return JSON.stringify([
            this.routeData.channel?.getChannelKey(),
            this.routeData.subscriberOfMe?.uid || WKApp.loginInfo.uid,
            this.routeData.subscriberOfMe?.role,
            WKApp.loginInfo.uid,
            WKApp.shared?.currentSpaceId,
        ])
    }

    get removalEntryError() {
        return this.removalEntryStatus === "error"
    }

    private invalidateRemovalEntry() {
        this.removalProbe?.abort()
        this.removalCursor = newMemberEntryCursor()
        this.removalEntryStatus = "partial"
        this.entryDirty = true
    }

    setRemovalEntryActive = (active: boolean) => {
        if (this.active === active) return
        this.active = active
        if (!active) {
            this.removalProbe?.abort()
            if (this.removalEntryStatus === "checking") {
                this.removalEntryStatus = "partial"
                this.entryDirty = true
            }
            return
        }
        // Resume an interrupted/invalidated check once on opening, not on render.
        if (this.entryDirty || this.removalEntryStatus === "idle" ||
            this.removalEntryScope !== this.entryScope()) {
            void this.refreshRemovalEntry()
        }
    }

    refreshRemovalEntry = async () => {
        if (!this.isMounted || !this.active || this.removalEntryStatus === "checking") return
        if (this.removalEntryScope !== this.entryScope()) this.removalCursor = newMemberEntryCursor()
        this.removalProbe?.abort()
        const controller = new AbortController()
        this.removalProbe = controller
        this.removalEntryScope = this.entryScope()
        this.entryDirty = false
        const viewerUid = WKApp.loginInfo.uid
        const channel = this.routeData.channel
        if (!channel || !viewerUid) return
        let scope = this.removalEntryScope
        const current = () => this.isMounted && this.active && !controller.signal.aborted && scope === this.entryScope()
        this.removalEntryStatus = "checking"
        this.notifyListener()
        try {
            let role = this.routeData.subscriberOfMe?.uid === viewerUid
                ? this.routeData.subscriberOfMe.role : undefined
            if (role === undefined) {
                const me = await ChannelMemberService.lookup(channel, viewerUid, controller.signal)
                if (!current()) return
                if (!me) {
                    this.removalEntryStatus = "none"
                    return
                }
                this.routeData.subscriberOfMe = me
                role = me.role
                scope = this.entryScope()
                this.removalEntryScope = scope
            }
            if (role === GroupRole.owner || role === GroupRole.manager ||
                this.ownsAnyRemovableBotInGroup(role)) {
                this.removalEntryStatus = "found"
                return
            }
            const result = await findRemovableGroupMember(channel, viewerUid, role, controller.signal, this.removalCursor)
            if (current()) this.removalEntryStatus = result
        } catch {
            if (current()) this.removalEntryStatus = "error"
        } finally {
            if (this.isMounted && this.removalProbe === controller &&
                this.removalEntryStatus === "checking" && !current()) {
                this.removalEntryStatus = "partial"
                this.removalCursor = newMemberEntryCursor()
                this.entryDirty = true
                this.notifyListener()
            }
            if (current()) this.notifyListener()
        }
    }

    ownsAnyRemovableBotInGroup(viewerRole: number) {
        const subscribers = this.routeData.subscriberAll || this.routeData.subscribers
        if(!subscribers || subscribers.length === 0) {
            return false
        }
        const viewerUid = WKApp.loginInfo.uid
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
