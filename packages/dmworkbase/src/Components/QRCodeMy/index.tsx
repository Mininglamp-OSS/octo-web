import React from "react";
import { Component, ReactNode } from "react";
import WKApp from "../../App";
import WKViewQueueHeader from "../WKViewQueueHeader";
import "./index.css"
import { QRCodeSVG } from 'qrcode.react';
import { Loading } from "@octo/ui";
import { Toast } from "@douyinfe/semi-ui";
import { I18nContext } from "../../i18n";

interface QRCodeMyState {
    qrcode?: string
   
}

export interface QRCodeMyProps {
    disableHeader?:boolean
}

export default class QRCodeMy extends Component<QRCodeMyProps, QRCodeMyState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    constructor(props:QRCodeMyProps) {
        super(props)
        this.state = {}
    }
    componentDidMount() {
        this.request()
    }

    async request() {
        const resp = await WKApp.dataSource.commonDataSource.qrcodeMy().catch((err) => {
            Toast.error(err.msg)
        })
        if (resp) {
            this.setState({
                qrcode: resp.data
            })
        }
    }

    render(): ReactNode {
        const { qrcode } = this.state
        const { disableHeader } = this.props
        return <div className="wk-qrcodemy">

            {
                !disableHeader? <WKViewQueueHeader title={this.context.t("base.qrCodeMy.title")} onBack={() => {
                    WKApp.routeLeft.pop()
                }}></WKViewQueueHeader>:undefined
            }
            <div className="wk-qrcodemy-content">
                <div className="wk-qrcodemy-content-qrcodebox">
                    <div className="wk-qrcodemy-content-qrcodeinfo">
                        <div className="wk-qrcodemy-content-userinfo">
                            <div className="wk-qrcodemy-content-userinfo-avatar">
                                <img src={WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")}></img>
                            </div>
                            <div className="wk-qrcodemy-content-userinfo-name">
                                {/* 自己的头像卡名字 —— 已实名优先展示 real_name */}
                                {WKApp.loginInfo.selfDisplayName()}
                            </div>
                        </div>
                        <div className="wk-qrcodemy-content-qrcode">
                            {
                                qrcode ? <QRCodeSVG value={qrcode}
                                    size={250}
                                    fgColor="#000000"></QRCodeSVG> : <Loading />
                            }
                        </div>
                        <div className="wk-qrcodemy-content-tip">
                            {this.context.t("base.qrCodeMy.scanToAdd", { values: { appName: WKApp.config.appName } })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }
}
