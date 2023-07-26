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

export interface ChannelSettingProps {
    onClose?: () => void
    channel: Channel
    conversationContext:ConversationContext
}

export default class ChannelSetting extends Component<ChannelSettingProps> {

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
        const { onClose, channel,conversationContext } = this.props
        return <Provider create={() => {
            this.vm = new ChannelSettingVM(channel)
            return this.vm
        }} render={(vm: ChannelSettingVM) => {
            vm.routeData.refresh = ()=>{
                vm.notifyListener()
            }
           
            return <RoutePage title={ vm.channel.channelType === ChannelTypeCustomerService?"聊天信息":`聊天信息（${vm.subscribers.length}）`} onClose={() => {
                if (onClose) {
                    onClose()
                }
            }} render={(context) => {
                vm.routeData.conversationContext = conversationContext
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