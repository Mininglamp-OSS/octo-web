import { Button, Spin } from "@douyinfe/semi-ui";
import classNames from "classnames";
import { Channel, ChannelInfo, WKSDK, Subscriber } from "wukongimjssdk";
import React from "react";
import { Component } from "react";
import WKApp from "../../App";
import Provider from "../../Service/Provider";
import Sections from "../Sections";
import "./index.css"
import { ChannelSettingVM } from "./vm";
import RoutePage from "../RoutePage";
import ConversationContext from "../Conversation/context";
import { ChannelTypeCustomerService } from "../../Service/Const";
import { I18nContext } from "../../i18n";

export interface ChannelSettingProps {
    onClose?: () => void
    onOpenChannelSearch?: () => void
    channel: Channel
    conversationContext:ConversationContext
}

export default class ChannelSetting extends Component<ChannelSettingProps> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    subscribers(): Subscriber[] {
        return this.vm.subscribers;
    }
    subscriberOfMe(): Subscriber | undefined {
        return this.vm.subscriberOfMe
    }
    channel(): Channel {
        const { channel } = this.props
        return channel
    }
    vm!: ChannelSettingVM

    componentDidMount() {
    }
    render() {
        const { onClose, onOpenChannelSearch, channel,conversationContext } = this.props
        return <Provider create={() => {
            this.vm = new ChannelSettingVM(channel)
            return this.vm
        }} render={(vm: ChannelSettingVM) => {
            vm.routeData.refresh = ()=>{
                vm.notifyListener()
            }

           let  memberCount = vm.subscribers.length

            const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
            if(channelInfo?.orgData?.member_count) {
                memberCount = channelInfo.orgData.member_count
            }
           
            return <RoutePage title={ vm.channel.channelType === ChannelTypeCustomerService
                ? this.context.t("base.channelSetting.title")
                : this.context.t("base.channelSetting.titleWithCount", { values: { count: memberCount } })
            } onClose={() => {
                if (onClose) {
                    onClose()
                }
            }} render={(context) => {
                vm.routeData.conversationContext = conversationContext
                vm.routeData.onOpenChannelSearch = onOpenChannelSearch
                context.setRouteData(vm.routeData)
                return <div className="wk-channelsetting-content">
                    {
                        vm.channelInfo ? <Sections sections={vm.sections(context)}></Sections> : <div className="wk-channelsetting-content-loading"><Spin ></Spin></div>
                    }
                </div>
            }} />
        }}>
        </Provider>


    }
}
