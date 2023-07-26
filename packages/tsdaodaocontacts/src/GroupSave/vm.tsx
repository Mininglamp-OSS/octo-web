import { WKApp, ProviderListener } from "@tsdaodao/base";
import { ChannelInfo,WKSDK } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
export class GroupSaveVM extends ProviderListener {
    groups:ChannelInfo[] = []
    channelInfoListener!:ChannelInfoListener


    didMount(): void {
       this.request()

       this.channelInfoListener = (channelInfo:ChannelInfo) => {
          if(this.groups.length > 0) {
            for (const group of this.groups) {
                if(group.channel.isEqual(channelInfo.channel)) {
                    this.request()
                    break
                }
            }
          }
       }

       WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }

    didUnMount(): void {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

   async request() {
       this.groups = await WKApp.dataSource.channelDataSource.groupSaveList()
       this.notifyListener()
    }
}