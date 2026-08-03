import React, { Component } from "react";
import { QRCodeSVG } from 'qrcode.react';
import "./index.css"
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";
import Provider from "../../Service/Provider";
import { ChannelQRCodeVM } from "./vm";
import { Button, Spin, Toast } from "@douyinfe/semi-ui";
import { copyToClipboard } from "../../Utils/clipboard";
import { I18nContext } from "../../i18n";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";

export interface ChannelQRCodeProps {
    channel: Channel
}

export default class ChannelQRCode extends Component<ChannelQRCodeProps> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    handleCopyLink = async (link: string) => {
        const ok = await copyToClipboard(link)
        if (ok) {
            Toast.success(this.context.t("base.channelQRCode.copySuccess"))
        } else {
            Toast.error(this.context.t("base.channelQRCode.copyFailed"))
        }
    }

    render() {
        const { channel } = this.props
        const { t } = this.context
        const channelInfo = getCurrentImChannelInfo(channel)
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
                                <p>{t("base.channelQRCode.verificationEnabled")}</p>
                                <p>{t("base.channelQRCode.inviteOnly")}</p>
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
                                    <QRCodeSVG value={vm.qrcodeResp?.qrcode || ""}
                                        size={250}
                                        fgColor="#000000"></QRCodeSVG>
                                    : undefined
                            }
                        </div>
                        {
                            vm.qrcodeResp ? <div className="wk-channelqrcode-expire">
                                {t("base.channelQRCode.expireHint", {
                                    values: { expire: vm.qrcodeResp.expire },
                                })}
                            </div> : undefined
                        }
                    </div>

                    {
                        vm.qrcodeResp && channelInfo?.orgData?.invite !== 1 ? <div className="wk-channelqrcode-actions">
                            <Button theme="solid" type="primary" onClick={() => this.handleCopyLink(vm.qrcodeResp!.invite_url || vm.qrcodeResp!.qrcode)}>
                                {t("base.channelQRCode.copyInviteLink")}
                            </Button>
                        </div> : undefined
                    }

                </div>
            </div>
        }}>

        </Provider>
    }
}
