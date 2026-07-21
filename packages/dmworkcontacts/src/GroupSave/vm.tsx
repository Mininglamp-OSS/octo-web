import { WKApp, ProviderListener, addImChannelInfoListener } from "@octo/base";
import { ChannelInfo,WKSDK } from "wukongimjssdk";
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

       this.unsubscribeChannelInfoListener = addImChannelInfoListener(WKSDK.shared(), this.channelInfoListener)
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
