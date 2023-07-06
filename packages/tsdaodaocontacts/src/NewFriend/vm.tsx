import { FriendApplyState, WKApp, ProviderListener } from "@tsdaodao/base";
import { FriendApply } from "@tsdaodao/base";


export class NewFriendVM extends ProviderListener {
    friendApplys: FriendApply[] = []
    sureLoading:boolean = false
    currentFriendApply?:FriendApply 

    didMount(): void {

        WKApp.shared.friendApplyMarkAllReaded()

       this.friendApplys = WKApp.shared.getFriendApplys()
       this.notifyListener()
    }

    friendSure(apply: FriendApply) {
        this.sureLoading = true
        this.currentFriendApply = apply
        this.notifyListener()

        WKApp.dataSource.commonDataSource.friendSure(apply.token || "").then(() => {
            apply.state = FriendApplyState.accepted
            WKApp.shared.updateFriendApply(apply)
             this.sureLoading = false
             this.notifyListener()
        }).catch(() => {
            this.sureLoading = false
             this.notifyListener()
        })
    }
}