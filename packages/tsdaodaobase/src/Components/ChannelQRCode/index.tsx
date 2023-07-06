import React, { Component } from "react";
import QRCode from 'qrcode.react';
import "./index.css"
import { Channel, WKSDK } from "wukongimjssdk/lib/sdk";
import WKApp from "../../App";
import Provider from "../../Service/Provider";
import { ChannelQRCodeVM } from "./vm";
import { Spin } from "@douyinfe/semi-ui";

export interface ChannelQRCodeProps {
    channel: Channel
}

export default class ChannelQRCode extends Component<ChannelQRCodeProps> {

    render() {
        const { channel } = this.props
        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
        return <Provider create={() => {
            return new ChannelQRCodeVM(channel)
        }} render={(vm: ChannelQRCodeVM) => {

            return <div className="wk-channelqrcode">
                <div className="wk-channelqrcode-box">
                    <div className="wk-channelqrcode-info">
                        <div className="wk-channelqrcode-info-avatar">
                            <img src={WKApp.shared.avatarChannel(channel)}></img>
                        </div>
                        <div className="wk-channelqrcode-info-name">
                            {channelInfo?.title}
                        </div>
                    </div>

                    <div className="wk-channelqrcode-qrcode-box">
                        {
                            channelInfo?.orgData?.invite === 1 &&   vm.qrcodeResp? <div className="wk-channelqrcode-qrcode-mask">
                                <p>该群已开启进群验证</p>
                                <p>只可通过邀请进群</p>
                            </div> : undefined
                        }

                        <div className="wk-channelqrcode-qrcode">
                            {
                                vm.qrcodeResp ? undefined : <div className="wk-channelqrcode-qrcode-loading">
                                    <Spin></Spin>
                                </div>
                            }
                            {
                                vm.qrcodeResp ?
                                    <QRCode value={vm.qrcodeResp?.qrcode || ""}
                                        size={250}
                                        fgColor="#000000"></QRCode>
                                    : undefined
                            }
                        </div>
                        {
                            vm.qrcodeResp ? <div className="wk-channelqrcode-expire">
                                该二维码7天内({vm.qrcodeResp.expire})前有效，重新进入将更新
                            </div> : undefined
                        }
                    </div>



                </div>
            </div>
        }}>

        </Provider>
    }
}