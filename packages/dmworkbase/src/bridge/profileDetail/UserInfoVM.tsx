import { ChannelInfoListener, SubscriberChangeListener } from "wukongimjssdk";
import {
  Channel,
  ChannelTypeGroup,
  ChannelInfo,
  ChannelTypePerson,
  WKSDK,
  Subscriber,
} from "wukongimjssdk";
import { Section } from "../../Service/Section";
import { ProviderListener } from "../../Service/Provider";
import WKApp from "../../App";
import RouteContext from "../../Service/Context";
import { ChannelTypeCommunityTopic, GroupRole } from "../../Service/Const";
import { Convert } from "../../Service/Convert";
import UserService from "../../Service/UserService";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { isRealnameVerified, displayName as resolveDisplayName } from "../../Utils/displayName";
import { parseThreadChannelId } from "../../Service/Thread";

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
  editingRemark = false;
  remarkDraft = "";
  savingRemark = false;
  remarkSaveError = "";
  private mounted = false;

  constructor(uid: string, fromChannel?: Channel, vercode?: string) {
    super();
    this.uid = uid;
    this.fromChannel = fromChannel;
    this.vercode = vercode;
  }

  didMount(): void {
    this.mounted = true;
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
    this.mounted = false;
    if (this.subscriberChangeListener) {
      WKSDK.shared().channelManager.removeSubscriberChangeListener(
        this.subscriberChangeListener
      );
    }
  }

  getRemark() {
    return this.channelInfo?.orgData?.remark || "";
  }

  startEditRemark() {
    this.editingRemark = true;
    this.remarkDraft = this.getRemark();
    this.notifyListener();
  }

  cancelEditRemark() {
    this.editingRemark = false;
    this.remarkDraft = "";
    this.notifyListener();
  }

  setRemarkDraft(value: string) {
    this.remarkDraft = value;
    this.notifyListener();
  }

  async saveRemark(): Promise<"ok" | "stale" | "failed"> {
    const requestedUid = this.uid;
    const remark = this.remarkDraft.trim();
    this.savingRemark = true;
    this.remarkSaveError = "";
    this.notifyListener();
    try {
      await UserService.updateRemark(requestedUid, remark);
      if (!this.isCurrentUid(requestedUid)) return "stale";
      if (this.channelInfo) {
        this.channelInfo.orgData = {
          ...this.channelInfo.orgData,
          remark,
          displayName: remark || this.channelInfo.title,
        };
      }
      this.editingRemark = false;
      this.remarkDraft = "";
      this.notifyListener();
      Promise.resolve(
        WKSDK.shared().channelManager.fetchChannelInfo(new Channel(requestedUid, ChannelTypePerson))
      ).catch((error: unknown) => {
        console.warn("[UserInfo] refresh channel after remark failed:", error);
      });
      Promise.resolve(this.reloadChannelInfo()).catch((error: unknown) => {
        console.warn("[UserInfo] reload profile after remark failed:", error);
      });
      return "ok";
    } catch (error: any) {
      if (!this.isCurrentUid(requestedUid)) return "stale";
      this.remarkSaveError = error?.msg || "";
      return "failed";
    } finally {
      if (this.isCurrentUid(requestedUid)) {
        this.savingRemark = false;
        this.notifyListener();
      }
    }
  }

  applyFriend(remark: string, spaceId?: string) {
    return UserService.applyFriend({
      uid: this.uid,
      remark,
      vercode: this.vercode || "",
      spaceId,
    });
  }

  private isCurrentUid(uid: string) {
    return this.mounted && this.uid === uid;
  }

  reloadSubscribers() {
    const sourceChannel =
      this.fromChannel && this.fromChannel.channelType !== ChannelTypePerson
        ? this.fromChannel
        : undefined;
    const memberChannel = this.memberContextChannel();
    const applySubscribers = (
      subscribers: Subscriber[] | undefined,
      options: { replaceUser?: boolean; replaceMe?: boolean } = {}
    ) => {
      if (!subscribers || subscribers.length === 0) return;
      for (const subscriber of subscribers) {
        if (
          subscriber.uid === this.uid &&
          (options.replaceUser || !this.fromSubscriberOfUser)
        ) {
          this.fromSubscriberOfUser = subscriber;
        } else if (
          subscriber.uid === WKApp.loginInfo.uid &&
          (options.replaceMe || !this.subscriberOfMy)
        ) {
          this.subscriberOfMy = subscriber;
        }
      }
    };

    if (sourceChannel) {
      applySubscribers(WKSDK.shared().channelManager.getSubscribes(sourceChannel), {
        replaceUser: true,
        replaceMe: true,
      });
    }
    if (
      memberChannel &&
      (!sourceChannel ||
        memberChannel.channelID !== sourceChannel.channelID ||
        memberChannel.channelType !== sourceChannel.channelType)
    ) {
      applySubscribers(WKSDK.shared().channelManager.getSubscribes(memberChannel), {
        replaceMe: true,
      });
    }
    if (sourceChannel || memberChannel) {
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
    const res = await UserService.getUserProfile(this.uid, this.profileGroupNo());
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

  private memberContextChannel(): Channel | undefined {
    if (!this.fromChannel || this.fromChannel.channelType === ChannelTypePerson) {
      return undefined;
    }
    if (this.fromChannel.channelType === ChannelTypeCommunityTopic) {
      const parsed = parseThreadChannelId(this.fromChannel.channelID);
      return parsed ? new Channel(parsed.groupNo, ChannelTypeGroup) : undefined;
    }
    return this.fromChannel;
  }

  private profileGroupNo(): string | undefined {
    if (!this.fromChannel || this.fromChannel.channelType === ChannelTypePerson) {
      return undefined;
    }
    if (this.fromChannel.channelType === ChannelTypeCommunityTopic) {
      return parseThreadChannelId(this.fromChannel.channelID)?.groupNo;
    }
    return this.fromChannel.channelID;
  }
}
