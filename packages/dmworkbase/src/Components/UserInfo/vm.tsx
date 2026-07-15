import { ChannelInfoListener, SubscriberChangeListener } from "wukongimjssdk";
import {
  Channel,
  ChannelInfo,
  ChannelTypePerson,
  WKSDK,
  Subscriber,
} from "wukongimjssdk";
import { Section } from "../../Service/Section";
import { ProviderListener } from "../../Service/Provider";
import WKApp from "../../App";
import RouteContext from "../../Service/Context";
import { GroupRole } from "../../Service/Const";
import { Convert } from "../../Service/Convert";
import UserService from "../../Service/UserService";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { isRealnameVerified, displayName as resolveDisplayName } from "../../Utils/displayName";

export class UserInfoRouteData {
  uid!: string;
  channelInfo?: ChannelInfo;
  fromChannel?: Channel;
  fromSubscriberOfUser?: Subscriber; // 当前用户在频道内的订阅信息
  isSelf!: boolean; // 是否是本人
  refresh!: () => void; // 刷新
}

export class UserInfoVM extends ProviderListener {
  uid!: string;
  fromChannel?: Channel;
  fromSubscriberOfUser?: Subscriber;
  subscriberOfMy?: Subscriber; // 当前登录用户在频道的订阅者信息
  fromChannelInfo?: ChannelInfo;
  channelInfo?: ChannelInfo;
  vercode?: string;
  subscriberChangeListener?: SubscriberChangeListener;

  constructor(uid: string, fromChannel?: Channel, vercode?: string) {
    super();
    this.uid = uid;
    this.fromChannel = fromChannel;
    this.vercode = vercode;
  }

  didMount(): void {
    this.reloadSubscribers();

    WKApp.shared.changeChannelAvatarTag(
      new Channel(this.uid, ChannelTypePerson)
    ); // 更新头像

    if (
      this.fromChannel &&
      this.fromChannel.channelType !== ChannelTypePerson
    ) {
      this.subscriberChangeListener = () => {
        this.reloadSubscribers();
      };
      WKSDK.shared().channelManager.addSubscriberChangeListener(
        this.subscriberChangeListener
      );

      // WKSDK.shared().channelManager.syncSubscribes(this.channel)
    }

    this.reloadFromChannelInfo();

    this.reloadChannelInfo();
  }

  didUnMount(): void {
    if (this.subscriberChangeListener) {
      WKSDK.shared().channelManager.removeSubscriberChangeListener(
        this.subscriberChangeListener
      );
    }
  }

  reloadSubscribers() {
    if (
      this.fromChannel &&
      this.fromChannel.channelType !== ChannelTypePerson
    ) {
      const subscribers = WKSDK.shared().channelManager.getSubscribes(
        this.fromChannel
      );
      if (subscribers && subscribers.length > 0) {
        for (const subscriber of subscribers) {
          if (subscriber.uid === this.uid) {
            this.fromSubscriberOfUser = subscriber;
          } else if (subscriber.uid === WKApp.loginInfo.uid) {
            this.subscriberOfMy = subscriber;
          }
        }
      }
      this.notifyListener();
    }
  }

  sections(context: RouteContext<UserInfoRouteData>) {
    context.setRouteData({
      uid: this.uid,
      channelInfo: this.channelInfo,
      fromChannel: this.fromChannel,
      fromSubscriberOfUser: this.fromSubscriberOfUser,
      isSelf: this.isSelf(),
      refresh: () => {
        this.notifyListener();
      },
    });
    return WKApp.shared.userInfos(context);
  }

  myIsManagerOrCreator() {
    return (
      this.subscriberOfMy?.role === GroupRole.manager ||
      this.subscriberOfMy?.role === GroupRole.owner
    );
  }

  shouldShowShort() {
    if (this.channelInfo?.orgData?.short_no) {
      return true
    }
    return false
  }

  relation(): number {
    return this.channelInfo?.orgData?.follow || 0;
  }

  displayName() {
    if (
      this.channelInfo?.orgData.remark &&
      this.channelInfo?.orgData.remark !== ""
    ) {
      return this.channelInfo?.orgData.remark;
    }
    if (
      this.fromSubscriberOfUser &&
      this.fromSubscriberOfUser.remark &&
      this.fromSubscriberOfUser.remark !== ""
    ) {
      return this.fromSubscriberOfUser.remark;
    }
    // GH #1121: 无本地备注时，如果对方已实名认证则优先展示真实姓名。
    // 未认证 / 字段缺失时走原逻辑（channelInfo.title）。
    const verifiedName = resolveDisplayName({
      real_name: this.channelInfo?.orgData?.real_name,
      realname_verified: this.channelInfo?.orgData?.realname_verified,
      name: this.channelInfo?.title,
    });
    if (verifiedName) return verifiedName;
    return this.channelInfo?.title;
  }

  /**
   * GH #1121: 对方是否已完成 OCTO 实名认证。
   * 仅用于个人资料页 ✓ 勾 + 「已实名」tag 展示，
   * 聊天气泡 / 群成员列表**不**消费此值（不在本任务范围）。
   */
  isRealnameVerified(): boolean {
    return isRealnameVerified(this.channelInfo?.orgData);
  }

  // 是否显示昵称
  showNickname() {
    if (this.hasRemark()) {
      return true;
    }
    if (this.hasChannelNickname()) {
      return true;
    }
    return false;
  }

  hasRemark() {
    if (
      this.channelInfo?.orgData.remark &&
      this.channelInfo?.orgData.remark !== ""
    ) {
      return true;
    }
    return false;
  }

  hasChannelNickname() {
    if (
      this.fromSubscriberOfUser &&
      this.fromSubscriberOfUser.remark &&
      this.fromSubscriberOfUser.remark !== ""
    ) {
      return true;
    }
    return false;
  }

  // 是否显示频道昵称
  showChannelNickname() {
    if (this.hasRemark() && this.hasChannelNickname()) {
      return true;
    }
    return false;
  }

  // 是否是本人
  isSelf() {
    return WKApp.loginInfo.uid === this.uid;
  }

  /**
   * 相对当前查看 Space 判断该用户是否为"外部"。
   *
   * 用途：UserInfo 底部是否隐藏"发送消息"按钮，作为跨 space DM 骚扰 Phase 1
   * 前端入口收紧的唯一判定源。判定字段沿用 resolveExternalForViewer，
   * 数据源优先级：
   *   1. fromSubscriberOfUser.orgData：群成员 subscriber 的归属 space 字段，
   *      这是从群里点头像进来的主路径，精度最高；
   *   2. channelInfo.orgData：用户 profile 接口（带 group_no 参数时后端会
   *      回填群内字段），作为缺失 subscriber 时的降级。
   * 缺少任何归属信息则按"非外部"对待（兼容老数据 / 1v1 直接打开等场景）。
   */
  isExternalToViewer(): boolean {
    if (this.isSelf()) {
      return false;
    }

    // 1) 群成员 subscriber 优先
    if (this.fromSubscriberOfUser?.orgData) {
      const org = this.fromSubscriberOfUser.orgData as any;
      const { isExternal } = resolveExternalForViewer({
        homeSpaceId: org.home_space_id,
        homeSpaceName: org.home_space_name,
        isExternalLegacy: org.is_external,
        sourceSpaceNameLegacy: org.source_space_name,
      });
      if (isExternal) return true;
    }

    // 2) /users/{uid}?group_no=... 返回的 orgData 作为降级
    if (this.channelInfo?.orgData) {
      const org = this.channelInfo.orgData as any;
      const { isExternal } = resolveExternalForViewer({
        homeSpaceId: org.home_space_id,
        homeSpaceName: org.home_space_name,
        isExternalLegacy: org.is_external,
        sourceSpaceNameLegacy: org.source_space_name,
      });
      if (isExternal) return true;
    }

    return false;
  }

  async reloadChannelInfo() {
    const res = await UserService.getUserProfile(this.uid, this.fromChannel?.channelID);
    this.channelInfo = Convert.userToChannelInfo(res);
    if (!this.vercode || this.vercode === "") {
      if (res.vercode && res.vercode !== "") {
        this.vercode = res.vercode
      }
    }

    this.notifyListener();
  }
  reloadFromChannelInfo() {
    if (this.fromChannel) {
      this.fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
        this.fromChannel
      );
      this.notifyListener();
    }
  }
}
