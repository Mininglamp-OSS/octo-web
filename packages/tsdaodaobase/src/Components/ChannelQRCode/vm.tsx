import { Channel } from "wukongimjssdk/lib/sdk";
import WKApp from "../../App";
import { ChannelQrcodeResp } from "../../Service/DataSource/DataSource";
import { ProviderListener } from "../../Service/Provider";


export class ChannelQRCodeVM extends ProviderListener {
    channel!:Channel
    qrcodeResp?: ChannelQrcodeResp

    constructor(channel:Channel) {
        super()
        this.channel = channel
    }   

    didMount(): void {
       this.requestQRCode()
    }

    async requestQRCode() {
        this.qrcodeResp = await WKApp.dataSource.channelDataSource.qrcode(this.channel)
        this.notifyListener()
    }
}