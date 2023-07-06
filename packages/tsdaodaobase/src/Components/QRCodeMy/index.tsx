import React from "react";
import { Component, ReactNode } from "react";
import WKApp from "../../App";
import WKViewQueueHeader from "../WKViewQueueHeader";
import "./index.css"
import QRCode from 'qrcode.react';
import { Spin, Toast } from "@douyinfe/semi-ui";

interface QRCodeMyState {
    qrcode?: string
   
}

export interface QRCodeMyProps {
    disableHeader?:boolean
}

export default class QRCodeMy extends Component<QRCodeMyProps, QRCodeMyState> {
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
                !disableHeader? <WKViewQueueHeader title="我的二维码" onBack={() => {
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
                                {WKApp.loginInfo.name}
                            </div>
                        </div>
                        <div className="wk-qrcodemy-content-qrcode">
                            {
                                qrcode ? <QRCode value={qrcode}
                                    size={250}
                                    fgColor="#000000"></QRCode> : <Spin></Spin>
                            }
                        </div>
                        <div className="wk-qrcodemy-content-tip">
                            扫一扫上面的二维码图案，加我{WKApp.config.appName}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }
}