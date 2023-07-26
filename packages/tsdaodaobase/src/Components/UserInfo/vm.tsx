import { ChannelInfoListener, SubscriberChangeListener } from "wukongimjssdk";
import { Channel, ChannelInfo, ChannelTypePerson, WKSDK, Subscriber } from "wukongimjssdk";
import { Section } from "../../Service/Section";
import { ProviderListener } from "../../Service/Provider";
import WKApp from "../../App";
import RouteContext from "../../Service/Context";
import { GroupRole } from "../../Service/Const";

export class UserInfoRouteData {
    uid!: string
    channelInfo?: ChannelInfo
    fromChannel?: Channel
    fromSubscriberOfUser?: Subscriber // 当前用户在频道内的订阅信息
    isSelf!:boolean // 是否是本人
    refresh!: () => void // 刷新

}

export class UserInfoVM extends ProviderListener {
    uid!: string
    fromChannel?: Channel
    fromSubscriberOfUser?: Subscriber
    subscriberOfMy?:Subscriber // 当前登录用户在频道的订阅者信息
    fromChannelInfo?: ChannelInfo
    channelInfo?: ChannelInfo
    vercode?:string
    channelInfoListener!: ChannelInfoListener
    subscriberChangeListener?: SubscriberChangeListener

    constructor(uid: string, fromChannel?: Channel,vercode?:string) {
        super()
        this.uid = uid
        this.fromChannel = fromChannel
        this.vercode = vercode
    }

    didMount(): void {

        this.reloadSubscribers()

        if (this.fromChannel && this.fromChannel.channelType !== ChannelTypePerson) {
            this.subscriberChangeListener = () => {
                this.reloadSubscribers()
            }
            WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)

            // WKSDK.shared().channelManager.syncSubscribes(this.channel)

        }

        this.reloadFromChannelInfo()

        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo.channel.channelType === ChannelTypePerson && channelInfo.channel.channelID === this.uid) {
                this.reloadChannelInfo()
            }
            if(this.fromChannel) {
                if(channelInfo.channel.isEqual(this.fromChannel)) {
                    this.reloadFromChannelInfo()
                }
            }
            this.notifyListener()
           
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        const channel = new Channel(this.uid, ChannelTypePerson)
        this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
        WKSDK.shared().channelManager.fetchChannelInfo(channel)
        if (this.channelInfo) {
            this.notifyListener()
        } 
    }

    didUnMount(): void {
        if (this.subscriberChangeListener) {
            WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
        }
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }
    
    reloadSubscribers() {
        if (this.fromChannel && this.fromChannel.channelType !== ChannelTypePerson) {
            const subscribers = WKSDK.shared().channelManager.getSubscribes(this.fromChannel)
            if (subscribers && subscribers.length > 0) {
                for (const subscriber of subscribers) {
                    if (subscriber.uid === this.uid) {
                        this.fromSubscriberOfUser = subscriber
                        
                    }else if(subscriber.uid === WKApp.loginInfo.uid) {
                        this.subscriberOfMy = subscriber
                    }
                }
            }
            this.notifyListener()
        }

    }

    sections(context: RouteContext<UserInfoRouteData>) {
        context.setRouteData({
            uid: this.uid,
            channelInfo: this.channelInfo,
            fromChannel: this.fromChannel,
            fromSubscriberOfUser: this.fromSubscriberOfUser,
            isSelf: this.isSelf(),
            refresh: () => {
                this.notifyListener()
            }
        })
        return WKApp.shared.userInfos(context)
    }

    myIsManagerOrCreator() {
      return this.subscriberOfMy?.role === GroupRole.manager || this.subscriberOfMy?.role === GroupRole.owner
    }

    shouldShowShort() {
        if( this.channelInfo?.orgData.short_no && this.channelInfo?.orgData.short_no == "") {
            return false
        }
        if(!this.fromChannel) {
            return true
        }
        if(this.myIsManagerOrCreator()) {
            return true
        }
        return false
    }

    relation(): number {
        return this.channelInfo?.orgData?.follow || 0
    }

    displayName() {
        if(this.channelInfo?.orgData.remark && this.channelInfo?.orgData.remark  !== "" ) {
            return this.channelInfo?.orgData.remark 
        }
        if(this.fromSubscriberOfUser && this.fromSubscriberOfUser.remark && this.fromSubscriberOfUser.remark !== "") {
            return this.fromSubscriberOfUser.remark
        }
        return this.channelInfo?.title
    }

    // 是否显示昵称
    showNickname() {
        if(this.hasRemark()) { 
            return true
        }
        if(this.hasChannelNickname()) {
            return true
        }
        return false
    }

    hasRemark() {
        if(this.channelInfo?.orgData.remark && this.channelInfo?.orgData.remark  !== "" ) { 
            return true
        }
        return false
    }

    hasChannelNickname() {
        if(this.fromSubscriberOfUser && this.fromSubscriberOfUser.remark && this.fromSubscriberOfUser.remark !== "") {
            return true
        }
        return false
    }

    // 是否显示频道昵称
    showChannelNickname() {
        if(this.hasRemark() && this.hasChannelNickname()) {
            return true
        }
        return false
    }

    // 是否是本人
   isSelf() {
       return WKApp.loginInfo.uid === this.uid
   }

    reloadChannelInfo() {
        this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(this.uid, ChannelTypePerson))
        this.notifyListener()
    }
    reloadFromChannelInfo() {
        if(this.fromChannel) {
            this.fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(this.fromChannel)
            this.notifyListener()
        }
    }
}