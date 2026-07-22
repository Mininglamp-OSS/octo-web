import {
  Channel,
  ChannelTypePerson,
  WKSDK,
  Message,
  MessageContentType,
  ConversationAction,
  ChannelTypeGroup,
  ChannelInfo,
  CMDContent,
  MessageText,
  Subscriber,
  Task,
  TaskStatus,
  MessageStatus,
} from "wukongimjssdk";
import React, { ElementType } from "react";
import { Smile, Scissors, ImagePlus, Paperclip, AtSign } from "lucide-react";
import { Howl, Howler } from "howler";
import WKApp, { FriendApply, FriendApplyState, ThemeMode } from "./App";
import { isChannelSearchEnabled } from "./features/channelSearch/feature";
import ChatSearchEntryButton from "./features/channelSearch/ChatSearchEntryButton";
import { ChannelSettingRouteData } from "./Components/ChannelSetting/context";
import { InputEdit } from "./Components/InputEdit";
import {
  ListItem,
  ListItemTip,
} from "./Components/ListItem";
import { Card, CardCell } from "./Messages/Card";
import { GifCell, GifContent } from "./Messages/Gif";
import { HistorySplitCell, HistorySplitContent } from "./Messages/HistorySplit";
import { ImageCell, ImageContent } from "./Messages/Image";
import { FileCell, FileContent } from "./Messages/File";
import {
  JoinOrganizationCell,
  JoinOrganizationContent,
} from "./Messages/JoinOrganization";
import {
  SignalMessageCell,
  SignalMessageContent,
} from "./Messages/SignalMessage/signalmessage";
import { SystemCell } from "./Messages/System";
import { TextCell } from "./Messages/Text";
import { RichTextCell, RichTextContent } from "./Messages/RichText";
import {
  InteractiveCardCell,
  InteractiveCardContent,
} from "./Messages/InteractiveCard";
import { TimeCell } from "./Messages/Time";
import { UnknownCell } from "./Messages/Unknown";
import { UnsupportCell, UnsupportContent } from "./Messages/Unsupport";
import {
  ChannelTypeCustomerService,
  ChannelTypeCommunityTopic,
  EndpointCategory,
  EndpointID,
  GroupRole,
  MessageContentTypeConst,
  unsupportMessageTypes,
  UserRelation,
} from "./Service/Const";
import RouteContext, {
  FinishButtonContext,
  RouteContextConfig,
} from "./Service/Context";
import { IModule } from "./Service/Module";
import { Row, Section } from "./Service/Section";
import { VoiceCell, VoiceContent } from "./Messages/Voice";
import { VideoCell, VideoContent } from "./Messages/Video";
import { TypingCell } from "./Messages/Typing";
import { LottieSticker, LottieStickerCell } from "./Messages/LottieSticker";
import { buildAddStickerMenu } from "./Messages/LottieSticker/collectMenu";
import { isMessageReactionEnabled } from "./Service/featureFlags";
import { reactionPickerOverlay, enablePointerTracking } from "./ui/message/MessageReactionPicker/ReactionPickerOverlay";
import { LocationCell, LocationContent } from "./Messages/Location";
import { Toast } from "@douyinfe/semi-ui";
import { DefaultEmojiService } from "./Service/EmojiService";
import IconClick from "./Components/IconClick";
import EmojiToolbar from "./Components/EmojiToolbar";
import MergeforwardContent, { MergeforwardCell } from "./Messages/Mergeforward";
import { wkConfirm } from "./Components/WKModal";
import { UserInfoRouteData } from "./bridge/profileDetail/UserInfoVM";
import {
  userInfoMembershipCreatedAt,
  userInfoMembershipOrgData,
} from "./bridge/profileDetail/userInfoMembership";
import { IconAlertCircle } from "@douyinfe/semi-icons";
import { TypingManager } from "./Service/TypingManager";
import APIClient from "./Service/APIClient";
import { patchSdkDecodeForExternalFields } from "./Service/Convert";
import { isMessageSelectable } from "./Service/messageSelection";
import ConversationVM from "./Components/Conversation/vm";
import { ScreenshotCell, ScreenshotContent } from "./Messages/Screenshot";
import FileToolbar from "./Components/FileToolbar";
import { ProhibitwordsService } from "./Service/ProhibitwordsService";
import { ApproveGroupMemberCell } from "./Messages/ApproveGroupMember";
import { notificationUtil } from "./Utils/NotificationUtil";
import { resolveExternalForViewer } from "./Utils/externalViewer";
import {
  isChannelDisbanded,
  isConversationDisbanded,
  isGroupDisbanded,
} from "./Utils/groupDisband";
import {
  copyImageToClipboard,
  copyRichTextToClipboard,
} from "./Utils/clipboard";
import { shouldSkipMessageForSpace } from "./Service/SpaceService";
import { t } from "./i18n";
import { THREAD_NAME_MAX_LENGTH } from "./Service/nameLimits";
import ThreadService from "./Service/ThreadService";
import {
  ThreadCreatedCell,
  ThreadCreatedContent,
} from "./Messages/ThreadCreated";
import { SummaryCardContent } from "./Messages/SummaryCard/SummaryCardContent";
import { SummaryCardCell } from "./Messages/SummaryCard";
import { parseThreadChannelId } from "./Service/Thread";
import { canShowRevokeMenu } from "./Service/revokePermission";
import {
  addImChannelInfoListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getImChannelSubscriberOfMe,
  getImChannelSubscribers,
  notifyImChannelInfoListeners,
  notifyImSubscriberChangeListeners,
  setImChannelSubscribersCache,
  syncImChannelSubscribers,
} from "./im-runtime/channelRuntime";
import {
  buildChannelDangerSection,
  buildChannelPreferenceSection,
  buildMyGroupNicknameSection,
} from "./features/channelSetting/channelSettingSections";
import { buildChannelMembersSection } from "./features/channelSetting/channelSettingMemberSection";
import { buildChannelGroupInfoSection } from "./features/channelSetting/channelSettingGroupInfoSection";
import {
  buildThreadActionsSection,
  buildThreadInfoSection,
  buildThreadMdSection,
  buildThreadWebhookSection,
} from "./features/channelSetting/channelSettingThreadSections";

/** execCommand 降级复制，用于 navigator.clipboard 不可用的场景 */
function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

const pendingRevokeRoleFetches = new Set<string>();

function findSubscriber(channel: Channel, uid: string): Subscriber | undefined {
  const subscribers = getImChannelSubscribers(
    WKSDK.shared(),
    channel
  ) as Subscriber[];
  return subscribers.find(
    (subscriber) => subscriber && subscriber.uid === uid
  );
}

function mergeSubscriberIntoCache(channel: Channel, subscriber: Subscriber) {
  const sdk = WKSDK.shared();
  const cached = getImChannelSubscribers(sdk, channel) as Subscriber[];
  const nextSubscribers = [...cached];
  const index = nextSubscribers.findIndex(
    (item) => item.uid === subscriber.uid
  );
  subscriber.channel = channel;

  if (index >= 0) {
    nextSubscribers[index] = {
      ...nextSubscribers[index],
      ...subscriber,
    };
  } else {
    nextSubscribers.push(subscriber);
  }

  setImChannelSubscribersCache(sdk, channel, nextSubscribers);
  notifyImSubscriberChangeListeners(sdk, channel);
}

function warmRevokeTargetRole(channel: Channel, uid: string) {
  if (findSubscriber(channel, uid)) {
    return;
  }

  const requestKey = `${channel.getChannelKey()}:${uid}`;
  if (pendingRevokeRoleFetches.has(requestKey)) {
    return;
  }

  pendingRevokeRoleFetches.add(requestKey);
  WKApp.dataSource.channelDataSource
    .subscriber(channel, uid)
    .then((subscriber) => {
      if (subscriber) {
        mergeSubscriberIntoCache(channel, subscriber);
      }
    })
    .catch(() => {
      // Permission remains fail-closed when the sender role cannot be resolved.
    })
    .finally(() => {
      pendingRevokeRoleFetches.delete(requestKey);
    });
}

export default class BaseModule implements IModule {
  messageTone?: Howl;

  id(): string {
    return "base";
  }
  init(): void {
    // dmwork-web#1069 round 2/3/5：补齐 WKSDK `Reply.prototype.decode` 中的
    // msg-level 外部来源字段，使引用消息预览与 Convert.toMessage /
    // MergeforwardContent.mapToMessage 行为一致。
    //
    // R5（PR#1081）已撤掉 R4 曾经追加的另外两个 SDK prototype patch
    // （Message.fromSendPacket / ChatManager.prototype.notifyMessageListeners），
    // WebSocket 推送、自发送、send-ack 回放路径改在业务层 ConversationVM
    // 收尾处补字段。此处仅剩 Reply.decode 一个受控 patch。幂等。
    patchSdkDecodeForExternalFields();

    APIClient.shared.logoutCallback = () => {
      WKApp.shared.logout();
    };

    WKApp.endpointManager.setMethod(
      EndpointID.emojiService,
      () => DefaultEmojiService.shared
    );

    // 启动时拉取服务端内置表情清单（fire-and-forget），据此动态重建 token→图 映射，
    // 取代各端硬编码；失败/离线时保持内置兜底，不影响首屏。apiURL 在 index.tsx 模块注册前
    // 已配置好，故此处 get 能拿到正确 base。
    DefaultEmojiService.shared.load?.().catch(() => {
      /* load() 内部已兜底处理，这里只防未捕获 rejection */
    });

    // 桥接：清单异步到达且确有变化时，广播全局事件，让已渲染消息列表(ConversationVM)与
    // 表情选择器(EmojiPanel)各自重渲染一次 —— 消除"首屏无缓存、消息先于 manifest 渲染"时
    // 新增服务端表情显示为裸 [xxx] token 的窗口(刷新后自愈)。EmojiService 不依赖 App，故由
    // 此处把它的 onChange 桥接到 mittBus。
    DefaultEmojiService.shared.onChange?.(() => {
      WKApp.mittBus.emit("emoji-manifest-updated");
    });

    WKApp.messageManager.registerMessageFactor(
      (contentType: number): ElementType | undefined => {
        switch (contentType) {
          case MessageContentType.text: // 文本消息
            return TextCell;
          case MessageContentTypeConst.richText: // 富文本（图文混排）
            return RichTextCell;
          case MessageContentTypeConst.interactiveCard: // 互动卡片（Adaptive Cards octo/v1）
            return InteractiveCardCell;
          case MessageContentType.image: // 图片消息
            return ImageCell;
          case MessageContentTypeConst.card: // 名片
            return CardCell;
          case MessageContentTypeConst.gif: // gif
            return GifCell;
          case MessageContentTypeConst.voice: // 语音
            return VoiceCell;
          case MessageContentTypeConst.mergeForward: // 合并转发
            return MergeforwardCell;
          case MessageContentTypeConst.joinOrganization: // 加入组织
            return JoinOrganizationCell;
          case MessageContentTypeConst.threadCreated: // 子区创建通知
            return ThreadCreatedCell;
          case MessageContentTypeConst.smallVideo: // 小视频
            return VideoCell;
          case MessageContentTypeConst.file: // 文件
            return FileCell;
          case MessageContentTypeConst.historySplit: // 历史消息风格线
            return HistorySplitCell;
          case MessageContentTypeConst.time: // 时间消息
            return TimeCell;
          case MessageContentTypeConst.typing: // 输入中...
            return TypingCell;
          case MessageContentTypeConst.lottieSticker: // 动图
          case MessageContentTypeConst.lottieEmojiSticker:
            return LottieStickerCell;
          case MessageContentTypeConst.location: // 定位
            return LocationCell;
          case MessageContentTypeConst.screenshot:
            return ScreenshotCell;
          case MessageContentType.signalMessage: // 端对端加密错误消息
          case MessageContentTypeConst.approveGroupMember: // 审批群成员
            return ApproveGroupMemberCell;
          case 15: // 智能总结卡片
            return SummaryCardCell;
          case 98:
            return SignalMessageCell;
          default:
            if (contentType <= 2000 && contentType >= 1000) {
              return SystemCell;
            }
        }
      }
    );

    WKSDK.shared().register(MessageContentType.image, () => new ImageContent()); // 图片
    WKSDK.shared().register(
      MessageContentTypeConst.file,
      () => new FileContent()
    ); // 文件

    WKSDK.shared().register(MessageContentTypeConst.card, () => new Card()); // 名片
    WKSDK.shared().register(
      MessageContentTypeConst.interactiveCard,
      () => new InteractiveCardContent()
    ); // 互动卡片（Adaptive Cards octo/v1）
    WKSDK.shared().register(
      MessageContentTypeConst.gif,
      () => new GifContent()
    ); // gif动图
    WKSDK.shared().register(
      MessageContentTypeConst.voice,
      () => new VoiceContent()
    ); // 语音正文
    WKSDK.shared().register(
      MessageContentTypeConst.smallVideo,
      () => new VideoContent()
    ); // 视频正文
    WKSDK.shared().register(
      MessageContentTypeConst.historySplit,
      () => new HistorySplitContent()
    ); // 历史分割线
    WKSDK.shared().register(
      MessageContentTypeConst.location,
      () => new LocationContent()
    ); // 定位
    WKSDK.shared().register(
      MessageContentTypeConst.lottieSticker,
      () => new LottieSticker()
    ); // 动图
    WKSDK.shared().register(
      MessageContentTypeConst.lottieEmojiSticker,
      () => new LottieSticker()
    ); // 动图
    WKSDK.shared().register(
      MessageContentTypeConst.mergeForward,
      () => new MergeforwardContent()
    ); // 合并转发
    WKSDK.shared().register(
      MessageContentTypeConst.screenshot,
      () => new ScreenshotContent()
    );
    // 加入组织
    WKSDK.shared().register(
      MessageContentTypeConst.joinOrganization,
      () => new JoinOrganizationContent()
    );
    // 子区创建通知
    WKSDK.shared().register(
      MessageContentTypeConst.threadCreated,
      () => new ThreadCreatedContent()
    );
    // 智能总结卡片
    WKSDK.shared().register(15, () => new SummaryCardContent());

    // 富文本（图文混排）
    WKSDK.shared().register(
      MessageContentTypeConst.richText,
      () => new RichTextContent()
    );

    // 未知消息
    WKApp.messageManager.registerCell(
      MessageContentType.unknown,
      (): ElementType => {
        return UnknownCell;
      }
    );

    // 不支持的消息
    for (const unsupportMessageType of unsupportMessageTypes) {
      WKSDK.shared().register(
        unsupportMessageType,
        () => new UnsupportContent()
      );
      WKApp.messageManager.registerCell(
        unsupportMessageType,
        (): ElementType => {
          return UnsupportCell;
        }
      );
    }

    WKSDK.shared().chatManager.addCMDListener((message: Message) => {
      const cmdContent = message.content as CMDContent;
      const param = cmdContent.param;

      if (cmdContent.cmd === "channelUpdate") {
        // 频道信息更新——通用事件（改名/公告/头像/解散等都会触发）。
        // 使用 fetchChannelInfo 拉取最新状态：channelUpdate 无法区分是改名/公告/头像还是解散，
        // 不能盲目调用 syncGroupDisbandState（会把正常群标记为已解散）。
        // 操作者本人的解散走 GroupManagement.handleDisband → syncGroupDisbandState
        // （本地直写规避 SDK 去重竞态），远程端依赖服务端推送的 channelUpdate 事件。
        void fetchImChannelInfo(
          WKSDK.shared(),
          new Channel(param.channel_id, param.channel_type)
        );
      } else if (cmdContent.cmd === "typing") {
        TypingManager.shared.addTyping(
          new Channel(
            cmdContent.param.channel_id,
            cmdContent.param.channel_type
          ),
          cmdContent.param.from_uid,
          cmdContent.param.from_name
        );
      } else if (cmdContent.cmd === "groupAvatarUpdate") {
        // 改变群头像缓存
        WKApp.shared.changeChannelAvatarTag(
          new Channel(param.group_no, ChannelTypeGroup)
        );
        // 通过触发channelInfoListener来更新UI
        void fetchImChannelInfo(
          WKSDK.shared(),
          new Channel(param.group_no, ChannelTypeGroup)
        );
      } else if (cmdContent.cmd === "unreadClear") {
        // 清除最近会话未读数量
        const channel = new Channel(param.channel_id, param.channel_type);
        const conversation =
          WKSDK.shared().conversationManager.findConversation(channel);
        let unread = 0;
        if (param.unread > 0) {
          unread = param.unread;
        }
        if (conversation) {
          conversation.unread = unread;
          WKSDK.shared().conversationManager.notifyConversationListeners(
            conversation,
            ConversationAction.update
          );
        }
      } else if (cmdContent.cmd === "conversationDeleted") {
        // 最近会话删除
        const channel = new Channel(param.channel_id, param.channel_type);
        WKSDK.shared().conversationManager.removeConversation(channel);
      } else if (cmdContent.cmd === "friendRequest") {
        // 好友申请
        // Space 隔离：不属于当前 Space 的好友申请不显示、不播提示音
        const cmdSpaceId = param.space_id;
        const curSpaceId = WKApp.shared.currentSpaceId;
        if (cmdSpaceId && curSpaceId && cmdSpaceId !== curSpaceId) {
          return;
        }
        const friendApply = new FriendApply();
        friendApply.uid = param.apply_uid;
        friendApply.to_name = param.apply_name;
        friendApply.status = FriendApplyState.apply;
        friendApply.remark = param.remark;
        friendApply.token = param.token;
        friendApply.unread = true;
        friendApply.createdAt = message.timestamp;
        WKApp.shared.addFriendApply(friendApply);
        this.tipsAudio();
      } else if (cmdContent.cmd === "friendAccept") {
        // 接受好友申请
        const toUID = param.to_uid;
        if (!toUID || toUID === "") {
          return;
        }
        if (param.from_uid) {
          void fetchImChannelInfo(
            WKSDK.shared(),
            new Channel(param.from_uid, ChannelTypePerson)
          );
        }

        WKApp.dataSource.contactsSync(); // 同步联系人

        const friendApplys = WKApp.shared.getFriendApplys();
        if (friendApplys && friendApplys.length > 0) {
          for (const friendApply of friendApplys) {
            if (toUID === friendApply.uid) {
              friendApply.unread = false;
              friendApply.status = FriendApplyState.accepted;
              WKApp.shared.updateFriendApply(friendApply);
              WKApp.endpointManager.invokes(
                EndpointCategory.friendApplyDataChange
              );
              break;
            }
          }
        }
      } else if (cmdContent.cmd === "friendDeleted") {
        WKApp.dataSource.contactsSync(); // 同步联系人
      } else if (cmdContent.cmd === "memberUpdate") {
        // 成员更新
        const channel = new Channel(
          cmdContent.param.group_no,
          ChannelTypeGroup
        );
        void syncImChannelSubscribers(WKSDK.shared(), channel);
      } else if (cmdContent.cmd === "onlineStatus") {
        // 好友在线状态改变
        const channel = new Channel(cmdContent.param.uid, ChannelTypePerson);
        const online = param.online === 1;
        const onlineChannelInfo =
          getImChannelInfo(WKSDK.shared(), channel);
        if (onlineChannelInfo) {
          onlineChannelInfo.online = online;
          if (!online) {
            onlineChannelInfo.lastOffline = new Date().getTime() / 1000;
          }
          notifyImChannelInfoListeners(WKSDK.shared(), onlineChannelInfo);
        } else {
          void fetchImChannelInfo(WKSDK.shared(), channel);
        }
      } else if (cmdContent.cmd === "syncConversationExtra") {
        // 同步最近会话扩展
        WKSDK.shared().conversationManager.syncExtra();
      } else if (cmdContent.cmd === "syncReminders") {
        // 同步提醒项
        WKSDK.shared().reminderManager.sync();
      } else if (cmdContent.cmd === "messageRevoke") {
        // 消息撤回
        const channel = message.channel;
        const messageID = param.message_id;
        let conversation =
          WKSDK.shared().conversationManager.findConversation(channel);
        if (
          conversation &&
          conversation.lastMessage &&
          conversation.lastMessage?.messageID === messageID
        ) {
          conversation.lastMessage.remoteExtra.revoke = true;
          conversation.lastMessage.remoteExtra.revoker = message.fromUID;
          WKSDK.shared().conversationManager.notifyConversationListeners(
            conversation,
            ConversationAction.update
          );
        }
      } else if (cmdContent.cmd === "userAvatarUpdate") {
        // 用户头像更新
        WKApp.shared.changeChannelAvatarTag(
          new Channel(param.uid, ChannelTypePerson)
        );
        WKApp.dataSource.notifyContactsChange();
      }
    });

    WKSDK.shared().chatManager.addMessageListener((message: Message) => {
      if (TypingManager.shared.hasTyping(message.channel)) {
        TypingManager.shared.removeTyping(message.channel);
      }
      switch (message.contentType) {
        case MessageContentTypeConst.channelUpdate:
          // 同 CMD channelUpdate：通用事件，无法区分是否解散，fetch 最新态。
          // 操作者本人的解散走 GroupManagement.handleDisband → syncGroupDisbandState。
          void fetchImChannelInfo(WKSDK.shared(), message.channel);
          break;
        case MessageContentTypeConst.addMembers:
        case MessageContentTypeConst.removeMembers:
          void syncImChannelSubscribers(WKSDK.shared(), message.channel);
          break;
      }

      if (this.allowNotify(message)) {
        let from = "";
        if (message.channel.channelType === ChannelTypeGroup) {
          const fromChannelInfo = getImChannelInfo(
            WKSDK.shared(),
            new Channel(message.fromUID, ChannelTypePerson)
          );
          if (fromChannelInfo) {
            from = `${fromChannelInfo?.orgData.displayName}: `;
          }
        }
        this.sendNotification(
          message,
          `${from}${message.content.conversationDigest}`
        );
        this.tipsAudio();
      }
    });

    addImChannelInfoListener(WKSDK.shared(), (channelInfo: ChannelInfo) => {
      if (channelInfo.channel.channelType === ChannelTypePerson) {
        if (WKApp.loginInfo.uid === channelInfo.channel.channelID) {
          WKApp.loginInfo.name = channelInfo.title;
          WKApp.loginInfo.shortNo = channelInfo.orgData.short_no;
          WKApp.loginInfo.sex = channelInfo.orgData.sex;
          // 此前在这里把 self Person channelInfo 的
          // realname_verified 回写到 loginInfo，并配合下方 addOnLogin 主动
          // fetch self channel 触发 listener。im-test 实测发现 **self 不在
          // friend/sync & conversation/sync 的 payload 里**，fetchChannelInfo
          // 单独请求也不会补 realname_verified 字段到 self channelInfo，这
          // 条 listener 实际上永不命中。实名状态现由后端在登录
          // payload 直发 + loginSuccess() 映射，listener 死代码已移除，
          // 避免「字段声明存在 ≠ 有人赋值」的认知陷阱再次复发。
          WKApp.loginInfo.save();
        }
      }
    });

    // 移除此前引入的 `addOnLogin` self channelInfo fetch。
    // 该 fetch 的唯一用途是触发上面 listener 把 realname_verified 回写到
    // loginInfo，但 self channelInfo 实际不下发 realname_verified（见上方
    // 注释），fetch 纯粹是死代码 + 每次登录多一次无用的网络请求。

    // 全局订阅 taskManager：上传失败时把 sendQueue 里对应消息标为 Fail 并触发 UI 刷新
    // 放在 module.init() 里保证只注册一次，避免多 ConversationVM 实例重复处理
    WKSDK.shared().taskManager.addListener((task: Task) => {
      if (task.status !== TaskStatus.fail && task.status !== TaskStatus.cancel)
        return;

      const msgTask = task as any; // MessageTask 有 message 属性
      const msg = msgTask.message;
      if (!msg) return;

      const channelKey = msg.channel?.getChannelKey?.();
      if (!channelKey) return;

      const sending = ConversationVM.sendQueue.get(channelKey);
      if (!sending) return;

      const idx = sending.findIndex((m) => m.clientMsgNo === msg.clientMsgNo);
      if (idx !== -1) {
        // 先标记失败状态，再移除，避免消息直接消失
        sending[idx].status = MessageStatus.Fail;
        // 只标记失败，不从队列移出，消息留在列表显示失败态
        // 通过 mittBus 通知对应 ConversationVM 刷新
        WKApp.mittBus.emit("task-upload-failed", { channelKey });
      }
    });

    this.registerChatMenus(); // 注册开始菜单

    this.registerUserInfo(); // 注册用户资料功能

    this.registerChannelSettings(); // 注册频道设置功能
    this.registerMessageContextMenus(); // 注册消息上下文菜单

    this.registerChatToolbars(); // 注册聊天工具栏
    this.registerChannelHeaderRightItems(); // 注册频道头部右侧入口按钮
  }

  /**
   * 频道头右侧入口按钮。dmworksummary / dmworktodo 各自注册了「智能总结」/「事项」
   * 图标；这里注册「查找聊天内容」的唯一入口，通过 feature 门禁后用 mittBus
   * 事件 wk:open-channel-search 通知 Pages/Chat 调 _openChannelSearchPanel()。
   */
  registerChannelHeaderRightItems() {
    WKApp.endpoints.registerChannelHeaderRightItem(
      "channelheader.search",
      ({ channel }) => {
        if (!isChannelSearchEnabled(channel)) return undefined;
        return <ChatSearchEntryButton channel={channel} />;
      },
      4900, // 排在 matter (5000) / summary (5100) 之前
    );
  }

  tipsAudio() {
    Howler.autoUnlock = false;
    if (!this.messageTone) {
      this.messageTone = new Howl({
        src: require("./assets/msg-tip.mp3"),
      });
      this.messageTone.play();
    } else {
      this.messageTone.play();
    }
  }

  allowNotify(message: Message) {
    if (WKApp.shared.notificationIsClose) {
      // 用户关闭了通知
      return false;
    }
    if (WKSDK.shared().isSystemMessage(message.contentType)) {
      // 系统消息不发通知
      return false;
    }
    if (message.fromUID === WKApp.loginInfo.uid) {
      // 自己发的消息不发通知
      return false;
    }
    // Space 隔离：不属于当前 Space 的消息不弹通知、不播提示音
    if (shouldSkipMessageForSpace(message)) {
      return false;
    }
    // BotFather 消息额外检查：channelType=Person 绕过了上面的过滤，
    // 需通过消息体 contentObj.space_id 判断是否属于当前 Space
    if (message.channel?.channelID === "botfather") {
      const curSpaceId = WKApp.shared.currentSpaceId;
      const msgSpaceId = (message.content as any)?.contentObj?.space_id;
      if (curSpaceId && msgSpaceId && msgSpaceId !== curSpaceId) {
        return false;
      }
    }

    // 已屏蔽（免打扰）的 channel 不播提示音、不发通知
    const channelInfo = getImChannelInfo(
      WKSDK.shared(),
      message.channel
    );
    if (channelInfo?.mute) {
      return false;
    }
    // 子区消息：额外检查父群聊 mute
    const parentGroupNo = channelInfo?.orgData?.parentGroupNo as
      | string
      | undefined;
    if (parentGroupNo) {
      const parentChannelInfo = getImChannelInfo(
        WKSDK.shared(),
        new Channel(parentGroupNo, ChannelTypeGroup)
      );
      if (parentChannelInfo?.mute) {
        return false;
      }
    }

    return true;
  }

  async sendNotification(message: Message, description?: string) {
    await notificationUtil.sendMessageNotification(message, description);
  }

  registerChatToolbars() {
    // 1. 表情
    WKApp.endpoints.registerChatToolbar("chattoolbar.emoji", (ctx) => {
      return (
        <EmojiToolbar
          conversationContext={ctx}
          icon={<Smile size={18} color="currentColor" />}
        />
      );
    });

    // 2. @ 提及（仅群聊显示）
    WKApp.endpoints.registerChatToolbar("chattoolbar.mention", (ctx) => {
      const channel = ctx.channel();
      if (channel.channelType === ChannelTypePerson) {
        return undefined;
      }
      return (
        <IconClick
          size="sm"
          icon={<AtSign size={18} color="currentColor" />}
          onClick={() => {
            ctx.messageInputContext().insertText("@");
          }}
        />
      );
    });

    // 3. 上传文件（合并了图片和文件上传）
    WKApp.endpoints.registerChatToolbar("chattoolbar.file", (ctx) => {
      return (
        <FileToolbar
          icon={<Paperclip size={18} color="currentColor" />}
          conversationContext={ctx}
        />
      );
    });
  }

  registerChatMenus() {
    WKApp.shared.chatMenusRegister("chatmenus.startchat", (param) => {
      const isDark = WKApp.config.themeMode === ThemeMode.dark;
      return {
        key: "start-group",
        title: t("base.module.chatMenus.startGroup"),
        icon: isDark
          ? new URL("./assets/popmenus_startchat_dark.png", import.meta.url)
              .href
          : new URL("./assets/popmenus_startchat.png", import.meta.url).href,
        onClick: () => {
          WKApp.endpoints.organizationalLayer(null);
        },
      };
    });
  }

  registerMessageContextMenus() {
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.copy",
      (message, context) => {
        const isText = message.contentType === MessageContentType.text;
        const isRichText =
          message.contentType === MessageContentTypeConst.richText;
        if (!isText && !isRichText) {
          return null;
        }

        return {
          title: t("base.module.contextMenus.copy"),
          onClick: () => {
            const selectedText = context.getCachedSelectedText?.();
            // RichText(=14)：取顶层 plain（server 权威纯文本），避免对 content
            // blocks 数组 stringify 丢字；text 消息走 content.text。
            const fullText = isRichText
              ? (message.content as RichTextContent).plain || ""
              : (message.content as MessageText).text || "";
            const textToCopy = selectedText || fullText;
            if (isRichText && !selectedText) {
              copyRichTextToClipboard(message.content as RichTextContent).catch(
                () => {
                  fallbackCopy(textToCopy);
                }
              );
              return;
            }
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(textToCopy).catch(() => {
                // navigator.clipboard 失败时降级到 execCommand
                fallbackCopy(textToCopy);
              });
            } else {
              fallbackCopy(textToCopy);
            }
          },
        };
      },
      1000
    );

    // 图片消息：复制图片到剪贴板
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.copyImage",
      (message) => {
        if (message.contentType !== MessageContentType.image) {
          return null;
        }
        const content = message.content as ImageContent;
        const rawSrc = content.url || content.remoteUrl || "";
        if (!rawSrc) return null;
        // 经过 datasource URL 处理，与渲染路径保持一致（补全 base URL、路径改写等）
        const src = WKApp.dataSource.commonDataSource.getImageURL(rawSrc, {
          width: content.width || 0,
          height: content.height || 0,
        });

        return {
          title: t("base.module.contextMenus.copyImage"),
          onClick: () => {
            copyImageToClipboard(src)
              .then(() =>
                Toast.success(t("base.module.contextMenus.copyImageSuccess"))
              )
              .catch((err: Error) =>
                Toast.warning(
                  err.message || t("base.module.contextMenus.copyFailed")
                )
              );
          },
        };
      },
      1100
    );

    // 「添加到我的贴纸」：仅位图贴纸消息显示（tgs/Lottie/空 url 一律隐藏）。
    // 后端 sticker/user/collect 幂等：重复收藏返回已存在记录，不新增、不占配额；
    // 因此点击即调，不需要前端查重。错误按 error.code 判断，不依赖 HTTP status。
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.addSticker",
      (message) => {
        const content = message.content as LottieSticker;
        // 纯逻辑（flag 门控 + 可收藏判定 + 收藏/广播/错误分发）抽到 collectMenu 便于单测。
        return buildAddStickerMenu(message.contentType, content, {
          stickerCustomEnabled: WKApp.remoteConfig.stickerCustomEnabled,
          collect: (req) =>
            WKApp.dataSource.commonDataSource.collectSticker(req),
          emitUpdated: () => WKApp.mittBus.emit("stickers-updated"),
          t,
          toast: Toast,
        });
      },
      1150
    );

    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.reaction",
      (message) => {
        // feature flag gate（默认关，详见 Service/featureFlags.ts）。
        if (!isMessageReactionEnabled()) {
          return null;
        }
        // demo 阶段 ReactionSlot 只接入了 TextCell（纯文本消息），右键入口同口径
        // 仅放行 text，避免在 RichText 等未渲染 summary 的消息上选表情后 store
        // 更新却无处回显。放开更多消息类型时，需同步在对应 cell 渲染 ReactionSlot。
        if (message.contentType !== MessageContentType.text) {
          return null;
        }
        return {
          title: t("base.module.contextMenus.react"),
          onClick: () => {
            reactionPickerOverlay.openAtLastPointer(
              message.messageID || message.clientMsgNo
            );
          },
        };
      },
      1200
    );

    // 仅在 feature flag 打开时安装 reaction picker 的全局指针追踪（右键菜单项
    // onClick 拿不到坐标，需靠它定位 picker）。flag 关时不安装 → 生产会话零全局
    // 副作用，兑现「flag OFF = 运行时 no-op」。DEV 改 localStorage 后刷新会重跑此处。
    if (isMessageReactionEnabled()) {
      enablePointerTracking();
    }

    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.forward",
      (message, context) => {
        if (WKApp.shared.notSupportForward.includes(message.contentType)) {
          return null;
        }

        return {
          title: t("base.module.contextMenus.forward"),
          onClick: () => {
            context.fowardMessageUI(message);
          },
        };
      },
      2000
    );
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.reply",
      (message, context) => {
        return {
          title: t("base.module.contextMenus.reply"),
          onClick: () => {
            context.reply(message, 1);
          },
        };
      }
    );
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.muli",
      (message, context) => {
        if (!isMessageSelectable(message)) {
          return null;
        }
        return {
          title: t("base.module.contextMenus.multiSelect"),
          onClick: () => {
            context.setEditOn(true);
          },
        };
      },
      3000
    );
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.revoke",
      (message, context) => {
        // 群/子区解散后只读，撤回属写操作，一并禁用（与 createThread guard 同模式）。
        // 用 isConversationDisbanded 而非 isChannelDisbanded：子区频道需经父群判断，
        // 直接对子区频道用 isChannelDisbanded 会因 channelType!=Group 而 fail-open。
        if (isConversationDisbanded(message.channel)) {
          return null;
        }
        const makeRevokeAction = () => ({
          title: t("base.module.contextMenus.revoke"),
          onClick: () => {
            context.revokeMessage(message).catch((err) => {
              Toast.error(err.msg);
            });
          },
        });

        // Bot 创建者可撤回自己创建的 Bot 发送的消息（与群管理员同等待遇，
        // 不受 message.send 和 24h 时间窗口限制，与后端行为一致）
        let isBotOwner = false;
        const fromChannelInfo = getImChannelInfo(
          WKSDK.shared(),
          new Channel(message.fromUID, ChannelTypePerson)
        );
        if (fromChannelInfo?.orgData?.robot === 1) {
          const creatorUID = fromChannelInfo.orgData.bot_creator_uid;
          if (creatorUID && creatorUID === WKApp.loginInfo.uid) {
            isBotOwner = true;
          }
        }

        // 群聊和子区的撤回权限判断
        const channelType = message.channel.channelType;
        const isGroup = channelType === ChannelTypeGroup;
        const isThread = channelType === ChannelTypeCommunityTopic;
        const threadInfo = isThread
          ? parseThreadChannelId(message.channel.channelID)
          : null;
        const roleChannel =
          isThread && threadInfo
            ? new Channel(threadInfo.groupNo, ChannelTypeGroup)
            : message.channel;
        let myRole: number | undefined;
        let targetRole: number | undefined;

        if (isGroup || isThread) {
          // 获取当前用户在群/子区父群中的角色
          const sub = getImChannelSubscriberOfMe(WKSDK.shared(), roleChannel);
          myRole = sub?.role;

          // 管理员撤回别人消息时必须确认发送者不是群主/管理员；角色未知时默认隐藏。
          if (myRole === GroupRole.manager && !message.send) {
            const targetMember = findSubscriber(roleChannel, message.fromUID);
            targetRole = targetMember?.role;
            if (targetRole == null) {
              warmRevokeTargetRole(roleChannel, message.fromUID);
            }
          }
        }

        const canShow = canShowRevokeMenu({
          messageID: message.messageID,
          channelType,
          messageSend: message.send,
          messageTimestamp: message.timestamp,
          revokeSecond: WKApp.remoteConfig.revokeSecond,
          isBotOwner,
          myRole,
          targetRole,
        });

        if (!canShow) {
          return null;
        }

        return makeRevokeAction();
      },
      4000
    );

    // 从消息创建子区（仅群组消息）
    WKApp.endpoints.registerMessageContextMenus(
      "contextmenus.createThread",
      (message, context) => {
        // 服务端未开启子区功能则隐藏
        if (!WKApp.remoteConfig.threadOn) {
          return null;
        }
        // 只有群组消息才显示
        if (message.channel.channelType !== ChannelTypeGroup) {
          return null;
        }
        // 系统消息不显示
        if (WKSDK.shared().isSystemMessage(message.contentType)) {
          return null;
        }
        // 群已解散则隐藏「创建子区」——解散后全员只读，不得新建子区。
        // 否则右键菜单会绕过 ThreadPanel 的禁用按钮直接 POST 建子区（后端虽拒，
        // 前端不应暴露该入口）。isChannelDisbanded fail-open，正常群不受影响。
        if (isChannelDisbanded(message.channel)) {
          return null;
        }
        return {
          title: t("base.module.contextMenus.createThread"),
          onClick: () => {
            // 使用消息内容作为默认名称，截取前20个字符
            const defaultName = (
              message.content?.conversationDigest || ""
            ).slice(0, 20);
            let threadName = defaultName;
            wkConfirm({
              title: t("base.module.createThread.title"),
              okText: t("base.module.createThread.ok"),
              cancelText: t("base.common.cancel"),
              content: (
                <div>
                  <div
                    style={{
                      marginBottom: "8px",
                      fontSize: "14px",
                      color: "var(--wk-text-secondary)",
                    }}
                  >
                    {t("base.module.createThread.nameLabel")}
                  </div>
                  <input
                    type="text"
                    placeholder={t("base.module.createThread.namePlaceholder")}
                    defaultValue={defaultName}
                    maxLength={THREAD_NAME_MAX_LENGTH}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--wk-bg-base)",
                      border: "1px solid var(--wk-border-default)",
                      borderRadius: "6px",
                      fontSize: "14px",
                      color: "var(--wk-text-primary)",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    onChange={(e) => {
                      threadName = e.target.value;
                    }}
                    autoFocus
                  />
                </div>
              ),
              onOk: async () => {
                if (!threadName || threadName.trim() === "") {
                  Toast.error(t("base.module.createThread.nameRequired"));
                  return;
                }
                if (threadName.length > THREAD_NAME_MAX_LENGTH) {
                  Toast.warning(t("base.threadCreate.nameMaxLength"));
                  return;
                }
                try {
                  const sourcePayload = message.content.contentObj ?? {
                    ...message.content.encodeJSON(),
                    type: message.content.contentType,
                  };
                  const resp = await ThreadService.createThreadFromMessage({
                    groupNo: message.channel.channelID,
                    name: threadName.trim(),
                    sourceMessageId: parseInt(message.messageID),
                    sourceMessagePayload: sourcePayload,
                  });
                  Toast.success(t("base.module.createThread.success"));
                  if (resp && resp.channel_id) {
                    WKApp.mittBus.emit("wk:thread-created", {
                      groupNo: message.channel.channelID,
                      shortId:
                        resp.short_id ||
                        parseThreadChannelId(resp.channel_id)?.shortId,
                      threadChannelId: resp.channel_id,
                    });
                    const channel = new Channel(
                      resp.channel_id,
                      ChannelTypeCommunityTopic
                    );
                    WKApp.endpoints.showConversation(channel);
                  }
                } catch (err: any) {
                  Toast.error(err.msg || t("base.module.createThread.failed"));
                }
              },
            });
          },
        };
      },
      5000
    );
  }

  registerUserInfo() {
    WKApp.shared.userInfoRegister(
      "userinfo.remark",
      (context: RouteContext<UserInfoRouteData>) => {
        const data = context.routeData();
        const channelInfo = data.channelInfo;
        const fromSubscriberOfUser = data.fromSubscriberOfUser;

        if (data.isSelf) {
          return;
        }

        const rows = new Array();
        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              key: "userinfo.remark",
              title: t("base.module.userInfo.remark"),
              onClick: () => {
                this.inputEditPush(
                  context,
                  channelInfo?.orgData?.remark,
                  async (value) => {
                    await WKApp.dataSource.commonDataSource
                      .userRemark(data.uid, value)
                      .catch((err) => {
                        Toast.error(err.msg);
                      });
                    return;
                  },
                  t("base.module.userInfo.remark")
                );
              },
            },
          })
        );
        const membershipOrgData = userInfoMembershipOrgData({
          fromChannel: data.fromChannel,
          channelInfo,
          fromSubscriberOfUser,
        });
        const membershipCreatedAt = userInfoMembershipCreatedAt(membershipOrgData);
        if (membershipCreatedAt) {
          let joinDesc = `${membershipCreatedAt.substr(0, 10)}`;
          if (
            membershipOrgData?.invite_uid &&
            membershipOrgData?.invite_uid !== ""
          ) {
            const inviterChannel = new Channel(
              membershipOrgData?.invite_uid,
              ChannelTypePerson
            );
            const inviteChannelInfo = getImChannelInfo(
              WKSDK.shared(),
              inviterChannel
            );
            if (inviteChannelInfo) {
              joinDesc += t("base.module.userInfo.invitedBy", {
                values: { name: inviteChannelInfo.title },
              });
            } else {
              void fetchImChannelInfo(WKSDK.shared(), inviterChannel);
            }
          } else {
            joinDesc += t("base.module.userInfo.joinedGroup");
          }
          rows.push(
            new Row({
              cell: ListItem,
              properties: {
                title: t("base.module.userInfo.joinMethod"),
                subTitle: joinDesc,
              },
            })
          );
        }

        return new Section({
          rows: rows,
        });
      }
    );

    WKApp.shared.userInfoRegister(
      "userinfo.others",
      (context: RouteContext<UserInfoRouteData>) => {
        const data = context.routeData();
        const channelInfo = data.channelInfo;
        const fromSubscriberOfUser = data.fromSubscriberOfUser;
        const relation = channelInfo?.orgData?.follow;
        const status = channelInfo?.orgData.status;

        if (data.isSelf) {
          return;
        }

        // GH#1090：同 Space 用户不显示「解除好友关系」和「拉黑」
        // 按钮。复用 userinfo.source 里的 resolveExternalForViewer，只有
        // 相对当前查看 Space 为外部（跨 Space）时才渲染这些按钮。
        const { isExternal } = resolveExternalForViewer({
          homeSpaceId: (channelInfo?.orgData?.home_space_id ??
            fromSubscriberOfUser?.orgData?.home_space_id) as string | undefined,
          homeSpaceName: (channelInfo?.orgData?.home_space_name ??
            fromSubscriberOfUser?.orgData?.home_space_name) as
            | string
            | undefined,
          isExternalLegacy: (channelInfo?.orgData?.is_external ??
            fromSubscriberOfUser?.orgData?.is_external) as number | undefined,
          sourceSpaceNameLegacy: (channelInfo?.orgData?.source_space_name ??
            fromSubscriberOfUser?.orgData?.source_space_name) as
            | string
            | undefined,
        });
        if (!isExternal) {
          // 同 Space（含 Bot）：完全不渲染，避免误删好友 / 拉黑同 Space 成员
          return;
        }

        const rows = new Array();
        if (relation === UserRelation.friend) {
          rows.push(
            new Row({
              cell: ListItem,
              properties: {
                title: t("base.module.userInfo.removeFriend"),
                onClick: () => {
                  WKApp.shared.baseContext.showAlert({
                    content: t("base.module.userInfo.removeFriendConfirm", {
                      values: { name: channelInfo?.orgData?.displayName || "" },
                    }),
                    onOk: () => {
                      WKApp.dataSource.commonDataSource
                        .deleteFriend(data.uid)
                        .then(() => {
                          const channel = new Channel(
                            data.uid,
                            ChannelTypePerson
                          );
                          const conversation =
                            WKSDK.shared().conversationManager.findConversation(
                              channel
                            );
                          if (conversation) {
                            WKApp.conversationProvider.clearConversationMessages(
                              conversation
                            );
                          }
                          WKSDK.shared().conversationManager.removeConversation(
                            channel
                          );
                          WKApp.endpointManager.invoke(
                            EndpointID.clearChannelMessages,
                            channel
                          );

                          void fetchImChannelInfo(
                            WKSDK.shared(),
                            new Channel(data.uid, ChannelTypePerson)
                          );
                        })
                        .catch((err) => {
                          Toast.error(err.msg);
                        });
                    },
                  });
                },
              },
            })
          );
        }

        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              title:
                status === UserRelation.blacklist
                  ? t("base.module.userInfo.removeFromBlacklist")
                  : t("base.module.userInfo.addToBlacklist"),
              onClick: () => {
                if (status === UserRelation.blacklist) {
                  WKApp.dataSource.commonDataSource
                    .blacklistRemove(data.uid)
                    .then(() => {
                      WKApp.dataSource.contactsSync();
                    })
                    .catch((err) => {
                      Toast.error(err.msg);
                    });
                } else {
                  WKApp.shared.baseContext.showAlert({
                    content: t("base.module.userInfo.addToBlacklistConfirm"),
                    onOk: () => {
                      WKApp.dataSource.commonDataSource
                        .blacklistAdd(data.uid)
                        .then(() => {
                          WKApp.dataSource.contactsSync();
                        })
                        .catch((err) => {
                          Toast.error(err.msg);
                        });
                    },
                  });
                }
              },
            },
          })
        );

        // rows.push(new Row({
        //     cell: ListItem,
        //     properties: {
        //         title: "投诉",
        //     }
        // }))
        return new Section({
          rows: rows,
        });
      }
    );

    WKApp.shared.userInfoRegister(
      "userinfo.source",
      (context: RouteContext<UserInfoRouteData>) => {
        const data = context.routeData();
        const channelInfo = data.channelInfo;
        const fromSubscriberOfUser = data.fromSubscriberOfUser;
        const relation = channelInfo?.orgData?.follow;
        if (data.isSelf) {
          return;
        }

        // 外部群成员：按当前查看 Space 相对判定。
        // 优先读 home_space_id / home_space_name（后端扩展），缺失时
        // 回落到旧的 is_external + source_space_name（1v1 users/{uid} 接口不具备
        // 群内外部成员上下文，source_desc 会为空）。
        const { isExternal: isExternalMember, sourceSpaceName } =
          resolveExternalForViewer({
            homeSpaceId: fromSubscriberOfUser?.orgData?.home_space_id as
              | string
              | undefined,
            homeSpaceName: fromSubscriberOfUser?.orgData?.home_space_name as
              | string
              | undefined,
            isExternalLegacy: fromSubscriberOfUser?.orgData?.is_external as
              | number
              | undefined,
            sourceSpaceNameLegacy: fromSubscriberOfUser?.orgData
              ?.source_space_name as string | undefined,
          });

        if (isExternalMember) {
          if (!sourceSpaceName || sourceSpaceName.trim() === "") {
            // 无所属空间信息时，不强制展示「来源」行
            return;
          }
          return new Section({
            rows: [
              new Row({
                cell: ListItem,
                properties: {
                  title: t("base.module.userInfo.source"),
                  subTitle: sourceSpaceName,
                },
              }),
            ],
          });
        }

        // 1v1 陌生联系人：保留旧的 source_desc fallback 逻辑（仅对好友展示）
        if (relation !== UserRelation.friend) {
          return;
        }
        const sourceDesc =
          (channelInfo?.orgData?.source_desc as string | undefined) || "";
        if (!sourceDesc || sourceDesc.trim() === "") {
          return;
        }
        return new Section({
          rows: [
            new Row({
              cell: ListItem,
              properties: {
                title: t("base.module.userInfo.source"),
                subTitle: sourceDesc,
              },
            }),
          ],
        });
      }
    );

    WKApp.shared.userInfoRegister(
      "userinfo.blacklist.tip",
      (context: RouteContext<UserInfoRouteData>) => {
        const data = context.routeData();
        const channelInfo = data.channelInfo;
        const status = channelInfo?.orgData?.status;
        if (data.isSelf) {
          return;
        }
        if (status !== UserRelation.blacklist) {
          return;
        }
        return new Section({
          rows: [
            new Row({
              cell: ListItemTip,
              properties: {
                tip: (
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconAlertCircle
                      size="small"
                      style={{ marginRight: "4px", color: "red" }}
                    />
                    {t("base.module.userInfo.blacklistTip")}
                  </div>
                ),
              },
            }),
          ],
        });
      },
      99999
    );
  }

  inputEditPush(
    context: RouteContext<any>,
    defaultValue: string,
    onFinish: (value: string) => Promise<void>,
    placeholder?: string,
    maxCount?: number,
    allowEmpty?: boolean,
    allowWrap?: boolean
  ) {
    let value: string;
    let finishButtonContext: FinishButtonContext;
    context.push(
      <InputEdit
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={(v, exceeded) => {
          value = v;
          if (!allowEmpty && (!value || value === "")) {
            finishButtonContext.disable(true);
          } else {
            finishButtonContext.disable(false);
          }
          if (exceeded) {
            finishButtonContext.disable(true);
          }
        }}
        maxCount={maxCount}
        allowWrap={allowWrap}
      ></InputEdit>,
      new RouteContextConfig({
        showFinishButton: true,
        onFinishContext: (finishBtnContext) => {
          finishButtonContext = finishBtnContext;
          finishBtnContext.disable(true);
        },
        onFinish: async () => {
          finishButtonContext.loading(true);
          await onFinish(value);
          finishButtonContext.loading(false);

          context.pop();
        },
      })
    );
  }

  registerChannelSettings() {
    WKApp.shared.channelSettingRegister("channel.subscribers", (context) => {
      return buildChannelMembersSection(context);
    });

    WKApp.shared.channelSettingRegister(
      "channel.base.setting",
      (context) => {
        return buildChannelGroupInfoSection(
          context,
          this.inputEditPush.bind(this)
        );
      },
      1000
    );

    WKApp.shared.channelSettingRegister(
      "channel.base.setting2",
      (context) => {
        return buildChannelPreferenceSection(context);
      },
      3000
    );

    WKApp.shared.channelSettingRegister(
      "channel.base.setting3",
      (context) => {
        return buildMyGroupNicknameSection(
          context,
          this.inputEditPush.bind(this)
        );
      },
      4000
    );

    // WKApp.shared.channelSettingRegister("channel.notify.setting.screen", (context) => {
    //     return new Section({
    //         subtitle: "在对话中的截屏，各方均会收到通知",
    //         rows: [
    //             new Row({
    //                 cell: ListItemSwitch,
    //                 properties: {
    //                     title: "截屏通知",
    //                 },
    //             }),
    //         ],
    //     })
    // })
    // WKApp.shared.channelSettingRegister("channel.notify.setting.revokemind", (context) => {
    //     return new Section({
    //         subtitle: "在对话中的消息撤回，各方均会收到通知",
    //         rows: [
    //             new Row({
    //                 cell: ListItemSwitch,
    //                 properties: {
    //                     title: "撤回通知",
    //                 },
    //             }),
    //         ],
    //     })
    // })
    // WKApp.shared.channelSettingRegister("channel.base.setting5", (context) => {
    //     return new Section({
    //         rows: [
    //             new Row({
    //                 cell: ListItem,
    //                 properties: {
    //                     title: "投诉",
    //                 },
    //             }),
    //         ],
    //     })
    // })

    WKApp.shared.channelSettingRegister(
      "channel.base.setting6",
      (context) => {
        return buildChannelDangerSection(context);
      },
      90000
    );

    // 子区 (Thread) 设置项
    WKApp.shared.channelSettingRegister(
      "thread.base.info",
      (context) => {
        return buildThreadInfoSection(
          context,
          this.inputEditPush.bind(this)
        );
      },
      500
    );

    // 子区 GROUP.md 设置项
    WKApp.shared.channelSettingRegister(
      "thread.md.setting",
      (context) => {
        return buildThreadMdSection(context);
      },
      1000
    );

    // 子区入站 Webhook（入口 A：聊天信息 / 完整会话设置页）。与入口 B
    // （ThreadPanel 右上角「…」菜单）完全同口径：复用群面板 ChannelWebhookPanel，
    // 传【父群】channel + 子区 short_id，datasource 据此拼
    // groups/{group}/threads/{short}/incoming-webhooks 做作用域隔离；
    // isManager 锚【父群】角色（子区无独立角色矩阵，普通成员仍可管自己创建的）。
    // 仅【活跃中】子区显示 —— 归档子区建 webhook 会被后端拒，避免无效入口，
    // 与入口 B 的 status 门槛保持一致。
    WKApp.shared.channelSettingRegister(
      "thread.webhook",
      (context) => {
        return buildThreadWebhookSection(context);
      },
      2000
    );

    // 子区设置说明：
    // - 消息免打扰/聊天置顶：子区继承父群组设置，暂不支持单独配置
    // - 成员管理：子区成员通过加入/离开操作，不支持手动添加
    WKApp.shared.channelSettingRegister(
      "thread.actions",
      (context) => {
        return buildThreadActionsSection(context);
      },
      90000
    );
  }
}
