import { WKApp, ProviderListener, addCurrentImChannelInfoListener } from "@octo/base";
import { ChannelInfo } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
export class GroupSaveVM extends ProviderListener {
    groups:ChannelInfo[] = []
    channelInfoListener!:ChannelInfoListener
    unsubscribeChannelInfoListener?: () => void


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

       this.unsubscribeChannelInfoListener = addCurrentImChannelInfoListener(this.channelInfoListener)
    }

    didUnMount(): void {
        this.unsubscribeChannelInfoListener?.()
        this.unsubscribeChannelInfoListener = undefined
    }

   async request() {
       this.groups = await WKApp.dataSource.channelDataSource.groupSaveList()
       this.notifyListener()
    }
}
