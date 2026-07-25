import { Message, CMDContent } from "wukongimjssdk";
import { FriendApplyState, WKApp, ProviderListener, addCurrentImCommandListener, removeCurrentImCommandListener } from "@octo/base";
import { FriendApply } from "@octo/base";

export class NewFriendVM extends ProviderListener {
  friendApplys: FriendApply[] = [];
  sureLoading: boolean = false;
  currentFriendApply?: FriendApply;

  async didMount(): Promise<void> {
    WKApp.shared.friendApplyMarkAllReaded();

    this.friendApplys = await this.getFriendApply();
    if (this.friendApplys.length === 0) {
      this.clearFriendApply();
    }
    this.notifyListener();
    // 监听好友申请
    addCurrentImCommandListener(this.friendRequestCMDListener);
  }

  didUnMount(): void {
    // 监听好友申请
    removeCurrentImCommandListener(this.friendRequestCMDListener);
  }

  friendSure(apply: FriendApply) {
    this.sureLoading = true;
    this.currentFriendApply = apply;
    this.notifyListener();

    WKApp.dataSource.commonDataSource
      .friendSure(apply.token || "")
      .then(() => {
        // Use immutable update pattern - update friendApplys array with new object
        this.friendApplys = this.friendApplys.map(item =>
          item.to_uid === apply.to_uid
            ? { ...item, status: FriendApplyState.accepted }
            : item
        );
        // WKApp.shared.updateFriendApply(apply);
        this.delFriendApply(apply);
        this.sureLoading = false;
        this.notifyListener();
      })
      .catch(() => {
        this.sureLoading = false;
        this.notifyListener();
      });
  }

  async getFriendApply(): Promise<FriendApply[]> {
    const fromData = {
      page_index: 1,
      page_size: 999,
    };
    const res = await WKApp.apiClient.get("/friend/apply", {
      param: fromData,
    });

    return res;
  }

  async delFriendApply(apply: FriendApply): Promise<void> {
    WKApp.apiClient
      .delete(`/friend/apply/${apply.to_uid}`)
      .then(async () => {
        this.friendApplys = await this.getFriendApply();
        this.sureLoading = false;
        this.notifyListener();
      })
      .catch(() => {
        this.sureLoading = false;
        this.notifyListener();
      });
  }

  async clearFriendApply(): Promise<void> {
    if (WKApp.loginInfo.isLogined()) {
      WKApp.loginInfo.setStorageItem(`${WKApp.loginInfo.uid}-friend-applys-unread-count`, '0')
    }
    await WKApp.apiClient.delete(`/user/reddot/friendApply`);
  }

  friendRequestCMDListener = async (message: Message) => {
    const cmdContent = message.content as CMDContent;
    if (cmdContent.cmd === "friendRequest") {
      this.friendApplys = await this.getFriendApply();
      this.notifyListener();
    }
  }
}
