import { ChannelInfoListener, SubscriberChangeListener } from "wukongimjssdk";
import { Channel, ChannelInfo, ChannelTypePerson, WKSDK, Subscriber } from "wukongimjssdk";
import { GroupRole, SubscriberStatus } from "../../Service/Const";
import RouteContext from "../../Service/Context";
import WKApp from "../../App";
import { ProviderListener } from "../../Service/Provider";
import { ChannelSettingRouteData } from "./context";


export class ChannelSettingVM extends ProviderListener {
    channel!: Channel
    channelInfo?:ChannelInfo

    subscribers: Subscriber[] = []
    subscribersTop: Subscriber[] = [] // 显示的成员
    subscriberChangeListener?: SubscriberChangeListener
    channelInfoListener!:ChannelInfoListener
    subscriberOfMe?: Subscriber
    routeData:ChannelSettingRouteData = new ChannelSettingRouteData()

    private _finishButtonLoading?:boolean
    private _finishButtonDisable?:boolean

    constructor(channel: Channel) {
        super()
        this.channel = channel
        this.routeData.channel = channel
        
    }

    get finishButtonLoading():boolean | undefined{
        return this._finishButtonLoading
    }

    set finishButtonDisable(v:boolean|undefined) {
        this._finishButtonDisable = v
        this.notifyListener()
    }
    get finishButtonDisable() {
        return this._finishButtonDisable
    }

    set finishButtonLoading(v:boolean|undefined) {
        this._finishButtonLoading = v
        this.notifyListener()
    }

    sections(context:RouteContext<ChannelSettingRouteData>) {
        return WKApp.shared.channelSettings(context)
    }

    didMount(): void {
        WKSDK.shared().channelManager.fetchChannelInfo(this.channel)

        this.reloadSubscribers()

        if(this.channel.channelType !== ChannelTypePerson) {
            this.subscriberChangeListener = () => {
                this.reloadSubscribers()
            }
            WKSDK.shared().channelManager.addSubscriberChangeListener(this.subscriberChangeListener)
    
            // WKSDK.shared().channelManager.syncSubscribes(this.channel)
    
        }
        this.channelInfoListener = (channelInfo:ChannelInfo) => {
            if(channelInfo.channel.isEqual(this.channel)) {
                this.reloadChannelInfo()
                return
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        this.reloadChannelInfo()
       
    }
    didUnMount(): void {
        if(this.subscriberChangeListener) {
            WKSDK.shared().channelManager.removeSubscriberChangeListener(this.subscriberChangeListener)
        }
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }


    reloadSubscribers() {
        if(this.channel.channelType !== ChannelTypePerson) {
            this.subscribers = WKSDK.shared().channelManager.getSubscribes(this.channel)
            if(this.subscribers && this.subscribers.length>0) {
                for (const subscriber of this.subscribers) {
                    if(subscriber.uid === WKApp.loginInfo.uid) {
                        this.subscriberOfMe = subscriber
                        this.routeData.subscriberOfMe = this.subscriberOfMe
                        break
                    }
                }
            }
            this.routeData.subscribers =   this.subscribers.filter((s)=>s.status === SubscriberStatus.normal)
            this.routeData.subscriberAll =this.subscribers

            this.notifyListener()
        }
      
    }

    reloadChannelInfo() {
        this.channelInfo = WKSDK.shared().channelManager.getChannelInfo(this.channel)
        this.routeData.channelInfo = this.channelInfo

        if(this.channelInfo && this.channel.channelType === ChannelTypePerson) {
            this.subscribers = [{
                name: this.channelInfo.title,
                uid: this.channelInfo.channel.channelID,
                remark: this.channelInfo.title,
                avatar: WKApp.shared.avatarUser(this.channel.channelID),
                role: GroupRole.normal,
                status: 1,
                channel: this.channel,
                isDeleted: false,
                version: 0,
                orgData: {},
            }]
            this.routeData.subscribers =  this.subscribers
        }
        this.notifyListener()
    }
}