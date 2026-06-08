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
import ChannelQRCode from "./Components/ChannelQRCode";
import { ChannelSettingRouteData } from "./Components/ChannelSetting/context";
import { IndexTableItem } from "./Components/IndexTable";
import { InputEdit } from "./Components/InputEdit";
import {
  ListItem,
  ListItemButton,
  ListItemButtonType,
  ListItemIcon,
  ListItemMuliteLine,
  ListItemSwitch,
  ListItemSwitchContext,
  ListItemTip,
} from "./Components/ListItem";
import { Subscribers } from "./Components/Subscribers";
import UserSelect, { ContactsSelect } from "./Components/UserSelect";
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
import { ChannelField } from "./Service/DataSource/DataSource";
import { IModule } from "./Service/Module";
import { Row, Section } from "./Service/Section";
import { VoiceCell, VoiceContent } from "./Messages/Voice";
import { VideoCell, VideoContent } from "./Messages/Video";
import { TypingCell } from "./Messages/Typing";
import { LottieSticker, LottieStickerCell } from "./Messages/LottieSticker";
import { LocationCell, LocationContent } from "./Messages/Location";
import { Toast, Tag } from "@douyinfe/semi-ui";
import { ChannelSettingManager } from "./Service/ChannelSetting";
import { DefaultEmojiService } from "./Service/EmojiService";
import IconClick from "./Components/IconClick";
import EmojiToolbar from "./Components/EmojiToolbar";
import MergeforwardContent, { MergeforwardCell } from "./Messages/Mergeforward";
import { wkConfirm } from "./Components/WKModal";
import { UserInfoRouteData } from "./Components/UserInfo/vm";
import { IconAlertCircle } from "@douyinfe/semi-icons";
import { TypingManager } from "./Service/TypingManager";
import APIClient from "./Service/APIClient";
import { patchSdkDecodeForExternalFields } from "./Service/Convert";
import { isMessageSelectable } from "./Service/messageSelection";
import ConversationVM from "./Components/Conversation/vm";
import { ChannelAvatar } from "./Components/ChannelAvatar";
import { ScreenshotCell, ScreenshotContent } from "./Messages/Screenshot";
import FileToolbar from "./Components/FileToolbar";
import { ProhibitwordsService } from "./Service/ProhibitwordsService";
import { SubscriberList } from "./Components/Subscribers/list";
import GlobalSearch from "./Components/GlobalSearch";
import { GroupMdEditor } from "./Components/GroupMdEditor";
import { GroupManagement } from "./Components/GroupManagement";
import { handleGlobalSearchClick } from "./Pages/Chat/vm";
import { ApproveGroupMemberCell } from "./Messages/ApproveGroupMember";
import { notificationUtil } from "./Utils/NotificationUtil";
import { resolveExternalForViewer } from "./Utils/externalViewer";
import {
  copyImageToClipboard,
  copyRichTextToClipboard,
} from "./Utils/clipboard";
import { shouldSkipMessageForSpace } from "./Service/SpaceService";
import { t } from "./i18n";
import {
  ThreadCreatedCell,
  ThreadCreatedContent,
} from "./Messages/ThreadCreated";
import { SummaryCardContent } from "./Messages/SummaryCard/SummaryCardContent";
import { SummaryCardCell } from "./Messages/SummaryCard";
import { parseThreadChannelId, ThreadStatus } from "./Service/Thread";
import { canShowRevokeMenu } from "./Service/revokePermission";

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
  const subscribers = WKSDK.shared().channelManager.getSubscribes(channel) as
    | Subscriber[]
    | null
    | undefined;
  return subscribers?.find(
    (subscriber) => subscriber && subscriber.uid === uid
  );
}

function mergeSubscriberIntoCache(channel: Channel, subscriber: Subscriber) {
  const channelManager = WKSDK.shared().channelManager;
  const cached = (channelManager.getSubscribes(channel) || []) as Subscriber[];
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

  channelManager.subscribeCacheMap.set(
    channel.getChannelKey(),
    nextSubscribers
  );
  channelManager.notifySubscribeChangeListeners(channel);
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

    WKApp.messageManager.registerMessageFactor(
      (contentType: number): ElementType | undefined => {
        switch (contentType) {
          case MessageContentType.text: // 文本消息
            return TextCell;
          case MessageContentTypeConst.richText: // 富文本（图文混排）
            return RichTextCell;
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
        // 频道信息更新
        WKSDK.shared().channelManager.fetchChannelInfo(
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
        WKSDK.shared().channelManager.fetchChannelInfo(
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
        WKApp.shared.setFriendApplysUnreadCount();
        this.tipsAudio();
      } else if (cmdContent.cmd === "friendAccept") {
        // 接受好友申请
        const toUID = param.to_uid;
        if (!toUID || toUID === "") {
          return;
        }
        if (param.from_uid) {
          WKSDK.shared().channelManager.fetchChannelInfo(
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
        WKSDK.shared().channelManager.syncSubscribes(channel);
      } else if (cmdContent.cmd === "onlineStatus") {
        // 好友在线状态改变
        const channel = new Channel(cmdContent.param.uid, ChannelTypePerson);
        const online = param.online === 1;
        const onlineChannelInfo =
          WKSDK.shared().channelManager.getChannelInfo(channel);
        if (onlineChannelInfo) {
          onlineChannelInfo.online = online;
          if (!online) {
            onlineChannelInfo.lastOffline = new Date().getTime() / 1000;
          }
          WKSDK.shared().channelManager.notifyListeners(onlineChannelInfo);
        } else {
          WKSDK.shared().channelManager.fetchChannelInfo(channel);
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
          WKSDK.shared().channelManager.fetchChannelInfo(message.channel);
          break;
        case MessageContentTypeConst.addMembers:
        case MessageContentTypeConst.removeMembers:
          WKSDK.shared().channelManager.syncSubscribes(message.channel);
          break;
      }

      if (this.allowNotify(message)) {
        let from = "";
        if (message.channel.channelType === ChannelTypeGroup) {
          const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
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

    WKSDK.shared().channelManager.addListener((channelInfo: ChannelInfo) => {
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
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
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
      const parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
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
        const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
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
          const sub =
            WKSDK.shared().channelManager.getSubscribeOfMe(roleChannel);
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
                try {
                  const sourcePayload = message.content.contentObj ?? {
                    ...message.content.encodeJSON(),
                    type: message.content.contentType,
                  };
                  const resp = await WKApp.apiClient.post(
                    `groups/${message.channel.channelID}/threads`,
                    {
                      name: threadName.trim(),
                      source_message_id: parseInt(message.messageID),
                      source_message_payload: sourcePayload,
                    }
                  );
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
        if (fromSubscriberOfUser) {
          let joinDesc = `${fromSubscriberOfUser.orgData.created_at.substr(
            0,
            10
          )}`;
          if (
            fromSubscriberOfUser.orgData?.invite_uid &&
            fromSubscriberOfUser.orgData?.invite_uid !== ""
          ) {
            const inviterChannel = new Channel(
              fromSubscriberOfUser.orgData?.invite_uid,
              ChannelTypePerson
            );
            const inviteChannelInfo =
              WKSDK.shared().channelManager.getChannelInfo(inviterChannel);
            if (inviteChannelInfo) {
              joinDesc += t("base.module.userInfo.invitedBy", {
                values: { name: inviteChannelInfo.title },
              });
            } else {
              WKSDK.shared().channelManager.fetchChannelInfo(inviterChannel);
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

                          WKSDK.shared().channelManager.fetchChannelInfo(
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
      const data = context.routeData() as ChannelSettingRouteData;
      const channel = data.channel;

      // 客服频道和子区不显示成员管理
      if (
        channel.channelType === ChannelTypeCustomerService ||
        channel.channelType === ChannelTypeCommunityTopic
      ) {
        return;
      }

      let addFinishButtonContext: FinishButtonContext;
      let removeFinishButtonContext: FinishButtonContext;
      let addSelectItems: IndexTableItem[];
      let removeSelectItems: Subscriber[];
      const disableSelectList = data.subscribers.map((subscriber) => {
        return subscriber.uid;
      });
      return new Section({
        rows: [
          new Row({
            cell: Subscribers,
            properties: {
              context: context,
              channel: channel,
              key: channel.getChannelKey(),
              canManageBotAdmin:
                !!data.channelInfo?.orgData?.can_manage_bot_admin,
              onAdd: () => {
                context.push(
                  <ContactsSelect
                    onSelect={(items) => {
                      addSelectItems = items;
                      addFinishButtonContext.disable(items.length === 0);
                    }}
                    disableSelectList={disableSelectList}
                  ></ContactsSelect>,
                  {
                    title: t("base.module.channelSettings.contactSelect"),
                    showFinishButton: true,
                    onFinish: async () => {
                      addFinishButtonContext.loading(true);

                      if (channel.channelType === ChannelTypePerson) {
                        const uids = new Array();
                        uids.push(WKApp.loginInfo.uid || "");
                        uids.push(channel.channelID);
                        for (const item of addSelectItems) {
                          uids.push(item.id);
                        }

                        const result = await WKApp.dataSource.channelDataSource
                          .createChannel(uids)
                          .catch((err) => {
                            Toast.error(err.msg);
                          });
                        if (result) {
                          WKApp.endpoints.showConversation(
                            new Channel(result.group_no, ChannelTypeGroup)
                          );
                        }
                      } else {
                        await WKApp.dataSource.channelDataSource.addSubscribers(
                          channel,
                          addSelectItems.map((item) => {
                            return item.id;
                          })
                        );
                        context.pop();
                      }
                      addFinishButtonContext.loading(false);
                    },
                    onFinishContext: (context) => {
                      addFinishButtonContext = context;
                      addFinishButtonContext.disable(true);
                    },
                  }
                );
              },
              onRemove: () => {
                context.push(
                  <SubscriberList
                    channel={channel}
                    onSelect={(items) => {
                      removeSelectItems = items;
                      removeFinishButtonContext.disable(items.length === 0);
                    }}
                    canSelect={true}
                  ></SubscriberList>,
                  {
                    title: t("base.module.channelSettings.removeMembers"),
                    showFinishButton: true,
                    onFinish: async () => {
                      removeFinishButtonContext.loading(true);
                      WKApp.dataSource.channelDataSource
                        .removeSubscribers(
                          channel,
                          removeSelectItems.map((item) => {
                            return item.uid;
                          })
                        )
                        .then(() => {
                          removeFinishButtonContext.loading(false);
                          context.pop();
                        })
                        .catch((err) => {
                          Toast.error(err.msg);
                        });
                    },
                    onFinishContext: (context) => {
                      removeFinishButtonContext = context;
                      removeFinishButtonContext.disable(true);
                    },
                  }
                );
              },
            },
          }),
        ],
      });
    });

    WKApp.shared.channelSettingRegister(
      "channel.base.setting",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        const channelInfo = data.channelInfo;
        const channel = data.channel;
        if (channel.channelType !== ChannelTypeGroup) {
          return undefined;
        }
        const rows = new Array();
        const isExternalGroup = channelInfo?.orgData?.is_external_group === 1;
        const groupNameSubTitle = isExternalGroup ? (
          <span>
            {channelInfo?.title}
            <Tag color="orange" size="small" style={{ marginLeft: 6 }}>
              {t("base.module.channelSettings.externalGroup")}
            </Tag>
          </span>
        ) : (
          channelInfo?.title
        );
        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              title: t("base.module.channelSettings.groupName"),
              subTitle: groupNameSubTitle,
              onClick: () => {
                if (!data.isManagerOrCreatorOfMe) {
                  Toast.warning(
                    t("base.module.channelSettings.groupNameOnlyManager")
                  );
                  return;
                }
                this.inputEditPush(
                  context,
                  channelInfo?.title || "",
                  (value: string) => {
                    return WKApp.dataSource.channelDataSource
                      .updateField(channel, ChannelField.channelName, value)
                      .catch((err) => {
                        Toast.error(err.msg);
                      });
                  },
                  t("base.module.channelSettings.groupNamePlaceholder"),
                  20
                );
              },
            },
          })
        );

        rows.push(
          new Row({
            cell: ListItemIcon,
            properties: {
              title: t("base.module.channelSettings.groupAvatar"),
              icon: (
                <img
                  style={{ width: "24px", height: "24px", borderRadius: "50%" }}
                  src={WKApp.shared.avatarChannel(channel)}
                  alt=""
                />
              ),
              onClick: () => {
                context.push(
                  <ChannelAvatar
                    showUpload={data.isManagerOrCreatorOfMe}
                    channel={channel}
                    context={context}
                  ></ChannelAvatar>,
                  { title: t("base.module.channelSettings.groupAvatar") }
                );
              },
            },
          })
        );

        rows.push(
          new Row({
            cell: ListItemIcon,
            properties: {
              title: t("base.module.channelSettings.groupQrCode"),
              icon: (
                <img
                  style={{ width: "24px", height: "24px" }}
                  src={require("./assets/icon_qrcode.png")}
                  alt=""
                />
              ),
              onClick: () => {
                context.push(
                  <ChannelQRCode channel={channel}></ChannelQRCode>,
                  new RouteContextConfig({
                    title: t("base.module.channelSettings.groupQrCard"),
                  })
                );
              },
            },
          })
        );
        rows.push(
          new Row({
            cell: ListItemMuliteLine,
            properties: {
              title: t("base.module.channelSettings.groupNotice"),
              subTitle: channelInfo?.orgData?.notice,
              onClick: () => {
                if (!data.isManagerOrCreatorOfMe) {
                  Toast.warning(
                    t("base.module.channelSettings.groupNoticeOnlyManager")
                  );
                  return;
                }
                this.inputEditPush(
                  context,
                  channelInfo?.orgData?.notice || "",
                  (value: string) => {
                    return WKApp.dataSource.channelDataSource
                      .updateField(channel, ChannelField.notice, value)
                      .catch((err) => {
                        Toast.error(err.msg);
                      });
                  },
                  t("base.module.channelSettings.groupNotice"),
                  400,
                  true,
                  true
                );
              },
            },
          })
        );
        if (channel.channelType === ChannelTypeGroup) {
          const hasGroupMd = channelInfo?.orgData?.has_group_md;
          const mdVersion = channelInfo?.orgData?.group_md_version || 0;
          rows.push(
            new Row({
              cell: ListItem,
              properties: {
                title: "GROUP.md",
                subTitle: hasGroupMd
                  ? t("base.module.channelSettings.configuredVersion", {
                      values: { version: mdVersion },
                    })
                  : t("base.module.channelSettings.notConfigured"),
                onClick: () => {
                  // Fall back to role check: creator (role=1) or manager (role=2) can edit GROUP.md
                  const latestData =
                    context.routeData() as ChannelSettingRouteData;
                  const subscriberOfMe = latestData?.subscriberOfMe;
                  const isOwnerOrManager =
                    subscriberOfMe &&
                    (subscriberOfMe.role === 1 || subscriberOfMe.role === 2);
                  const canEditMd =
                    !!latestData?.channelInfo?.orgData?.can_edit_group_md ||
                    isOwnerOrManager;
                  context.push(
                    <GroupMdEditor channel={channel} canEdit={canEditMd} />,
                    new RouteContextConfig({
                      title: "GROUP.md",
                    })
                  );
                },
              },
            })
          );

          const latestData2 = context.routeData() as ChannelSettingRouteData;
          const subscriberOfMe2 = latestData2?.subscriberOfMe;
          if (
            subscriberOfMe2 &&
            (subscriberOfMe2.role === 1 || subscriberOfMe2.role === 2)
          ) {
            rows.push(
              new Row({
                cell: ListItem,
                properties: {
                  title: t("base.module.channelSettings.groupManagement"),
                  onClick: () => {
                    const rd = context.routeData() as ChannelSettingRouteData;
                    const me = rd?.subscriberOfMe;
                    const isCreator = me?.role === 1;
                    context.push(
                      <GroupManagement
                        channel={channel}
                        isCreator={isCreator}
                        context={context}
                      />,
                      new RouteContextConfig({
                        title: t("base.module.channelSettings.groupManagement"),
                      })
                    );
                  },
                },
              })
            );
          }
        }
        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              title: t("base.module.channelSettings.remark"),
              subTitle: channelInfo?.orgData?.remark,
              onClick: () => {
                this.inputEditPush(
                  context,
                  channelInfo?.orgData?.remark || "",
                  (value: string) => {
                    return ChannelSettingManager.shared
                      .remark(value, channel)
                      .then(() => {
                        data.refresh();
                      });
                  },
                  t("base.module.channelSettings.remarkPlaceholder"),
                  15,
                  true
                );
              },
            },
          })
        );
        return new Section({
          rows: rows,
        });
      },
      1000
    );

    // [隐藏] 2026-04-15 隐藏「查找聊天内容」入口，产品决策，随时可恢复
    // WKApp.shared.channelSettingRegister(
    //   "channel.base.settingMessageHistory",
    //   (context) => {
    //     const data = context.routeData() as ChannelSettingRouteData;
    //     const channel = data.channel
    //
    //     return new Section({
    //       rows: [
    //         new Row({
    //           cell: ListItem,
    //           properties: {
    //             title: "查找聊天内容",
    //             onClick: () => {
    //               WKApp.shared.baseContext.showGlobalModal({
    //                 body: <GlobalSearch channel={channel} onClick={(item: any, type: string) => {
    //                   void handleGlobalSearchClick(item, type, () => {
    //                     WKApp.shared.baseContext.hideGlobalModal()
    //                   })
    //                 }} />,
    //                 width: "80%",
    //                 height: "80%",
    //                 onCancel: () => {
    //                   WKApp.shared.baseContext.hideGlobalModal()
    //                 }
    //               })
    //             },
    //           },
    //         }),
    //       ],
    //     });
    //   },
    //   1100
    // );

    WKApp.shared.channelSettingRegister(
      "channel.base.setting2",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        const channelInfo = data.channelInfo;
        const channel = data.channel;
        const rows = new Array<Row>();

        // 客服频道和子区使用各自的设置
        if (
          channel.channelType === ChannelTypeCustomerService ||
          channel.channelType === ChannelTypeCommunityTopic
        ) {
          return;
        }

        rows.push(
          new Row({
            cell: ListItemSwitch,
            properties: {
              title: t("base.module.channelSettings.mute"),
              checked: channelInfo?.mute,
              onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                ctx.loading = true;
                ChannelSettingManager.shared
                  .mute(v, channel)
                  .then(() => {
                    ctx.loading = false;
                    data.refresh();
                  })
                  .catch(() => {
                    ctx.loading = false;
                  });
              },
            },
          })
        );

        rows.push(
          new Row({
            cell: ListItemSwitch,
            properties: {
              title: t("base.module.channelSettings.pin"),
              checked: channelInfo?.top,
              onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                ctx.loading = true;
                ChannelSettingManager.shared
                  .top(v, channel)
                  .then(() => {
                    ctx.loading = false;
                    data.refresh();
                  })
                  .catch(() => {
                    ctx.loading = false;
                  });
              },
            },
          })
        );

        if (channel.channelType === ChannelTypeGroup) {
          rows.push(
            new Row({
              cell: ListItemSwitch,
              properties: {
                title: t("base.module.channelSettings.saveToContacts"),
                checked: channelInfo?.orgData.save === 1,
                onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                  ctx.loading = true;
                  ChannelSettingManager.shared
                    .save(v, channel)
                    .then(() => {
                      ctx.loading = false;
                      data.refresh();
                    })
                    .catch(() => {
                      ctx.loading = false;
                    });
                },
              },
            })
          );
        }

        // 群级「允许群内 Bot 免@回答」总开关已移至「群管理」界面（GroupManagement），
        // 不再挂在频道设置区。见 Components/GroupManagement/index.tsx。
        return new Section({
          rows: rows,
        });
      },
      3000
    );

    WKApp.shared.channelSettingRegister(
      "channel.base.setting3",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        if (data.channel.channelType !== ChannelTypeGroup) {
          return undefined;
        }

        let name = data.subscriberOfMe?.remark;
        if (!name || name === "") {
          name = data.subscriberOfMe?.name;
        }

        return new Section({
          rows: [
            new Row({
              cell: ListItem,
              properties: {
                title: t("base.module.channelSettings.myGroupNickname"),
                subTitle: name,
                onClick: () => {
                  this.inputEditPush(
                    context,
                    name || "",
                    (value: string) => {
                      return WKApp.dataSource.channelDataSource.subscriberAttrUpdate(
                        data.channel,
                        WKApp.loginInfo.uid || "",
                        { remark: value }
                      );
                    },
                    t("base.module.channelSettings.myGroupNicknamePlaceholder"),
                    10,
                    true
                  );
                },
              },
            }),
          ],
        });
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
        const data = context.routeData() as ChannelSettingRouteData;
        if (data.channel.channelType !== ChannelTypeGroup) {
          return undefined;
        }
        return new Section({
          rows: [
            new Row({
              cell: ListItemButton,
              properties: {
                title: t("base.module.channelSettings.clearMessages"),
                type: ListItemButtonType.warn,
                onClick: () => {
                  WKApp.shared.baseContext.showAlert({
                    content: t(
                      "base.module.channelSettings.clearMessagesConfirm"
                    ),
                    onOk: async () => {
                      const conversation =
                        WKSDK.shared().conversationManager.findConversation(
                          data.channel
                        );
                      if (!conversation) {
                        return;
                      }
                      await WKApp.conversationProvider.clearConversationMessages(
                        conversation
                      );
                      conversation.lastMessage = undefined;
                      WKApp.endpointManager.invoke(
                        EndpointID.clearChannelMessages,
                        data.channel
                      );
                    },
                  });
                },
              },
            }),
            new Row({
              cell: ListItemButton,
              properties: {
                title: t("base.module.channelSettings.deleteAndExit"),
                type: ListItemButtonType.warn,
                onClick: () => {
                  WKApp.shared.baseContext.showAlert({
                    content: t(
                      "base.module.channelSettings.deleteAndExitConfirm"
                    ),
                    onOk: async () => {
                      WKApp.dataSource.channelDataSource
                        .exitChannel(data.channel)
                        .catch((err) => {
                          Toast.error(err.msg);
                        });
                      WKApp.conversationProvider.deleteConversation(
                        data.channel
                      );
                    },
                  });
                },
              },
            }),
          ],
        });
      },
      90000
    );

    // 子区 (Thread) 设置项
    WKApp.shared.channelSettingRegister(
      "thread.base.info",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        const channel = data.channel;
        if (channel.channelType !== ChannelTypeCommunityTopic) {
          return undefined;
        }
        const threadInfo = parseThreadChannelId(channel.channelID);

        // data.channelInfo 由 ChannelSettingVM 通过 channelInfoListener 维护：
        // vm.didMount → fetchChannelInfo(channel) → channelInfoCallback（子区分支）
        // → title = thread.name → notifyListeners → reloadChannelInfo → routeData.channelInfo 更新
        // sections() 重跑时 data.channelInfo 已有正确数据，直接读即可。
        const channelInfo = data.channelInfo;
        const threadName = channelInfo?.title;

        // 权限：只有创建者或群管理者可以修改名称
        const thread = channelInfo?.orgData?.thread as any;
        const isCreator = thread?.creator_uid === WKApp.loginInfo.uid;
        const isManagerOrOwner = data.isManagerOrCreatorOfMe;
        const canEdit = isCreator || isManagerOrOwner;
        const statusTitle =
          thread?.status === ThreadStatus.Archived
            ? t("base.module.thread.status.archived")
            : thread?.status === ThreadStatus.Deleted
            ? t("base.module.thread.status.deleted")
            : t("base.module.thread.status.active");
        const statusColor =
          thread?.status === ThreadStatus.Archived
            ? "grey"
            : thread?.status === ThreadStatus.Deleted
            ? "red"
            : "green";

        const rows = new Array<Row>();
        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              title: t("base.module.thread.name"),
              subTitle: threadName,
              onClick: () => {
                if (!threadInfo) return;
                if (!canEdit) {
                  Toast.warning(
                    t("base.module.thread.nameOnlyCreatorOrManager")
                  );
                  return;
                }
                this.inputEditPush(
                  context,
                  threadName || "",
                  async (value: string) => {
                    try {
                      await WKApp.dataSource.channelDataSource.threadUpdate(
                        threadInfo.groupNo,
                        threadInfo.shortId,
                        { name: value }
                      );
                    } catch (err: any) {
                      Toast.error(
                        err?.msg || t("base.module.thread.saveFailedRetry")
                      );
                      return; // 失败时 inputEditPush 正常关闭，不刷新缓存
                    }
                    // 清除缓存后重新拉取，拿到新数据再刷新 UI
                    WKSDK.shared().channelManager.deleteChannelInfo(channel);
                    await WKSDK.shared().channelManager.fetchChannelInfo(
                      channel
                    );
                    data.refresh();
                  },
                  t("base.module.thread.name"),
                  50
                );
              },
            },
          })
        );
        rows.push(
          new Row({
            cell: ListItem,
            properties: {
              title: t("base.module.thread.status.title"),
              subTitle: (
                <Tag color={statusColor} size="small">
                  {statusTitle}
                </Tag>
              ),
            },
          })
        );
        if (threadInfo) {
          const groupChannel = new Channel(
            threadInfo.groupNo,
            ChannelTypeGroup
          );
          const groupInfo =
            WKSDK.shared().channelManager.getChannelInfo(groupChannel);
          if (!groupInfo) {
            WKSDK.shared().channelManager.fetchChannelInfo(groupChannel);
          }
          const groupName = groupInfo?.title || threadInfo.groupNo;
          rows.push(
            new Row({
              cell: ListItem,
              properties: {
                title: t("base.module.thread.parentGroup"),
                subTitle: groupName,
                onClick: () => {
                  WKApp.endpoints.showConversation(groupChannel);
                },
              },
            })
          );
        }
        return new Section({
          title: t("base.module.thread.info"),
          rows: rows,
        });
      },
      500
    );

    // 子区 GROUP.md 设置项
    WKApp.shared.channelSettingRegister(
      "thread.md.setting",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        const channel = data.channel;
        const channelInfo = data.channelInfo;
        if (channel.channelType !== ChannelTypeCommunityTopic) {
          return undefined;
        }
        const threadInfo = parseThreadChannelId(channel.channelID);
        if (!threadInfo) {
          return undefined;
        }

        const hasThreadMd = channelInfo?.orgData?.has_thread_md;
        const mdVersion = channelInfo?.orgData?.thread_md_version || 0;

        return new Section({
          rows: [
            new Row({
              cell: ListItem,
              properties: {
                title: "GROUP.md",
                subTitle: hasThreadMd
                  ? t("base.module.channelSettings.configuredVersion", {
                      values: { version: mdVersion },
                    })
                  : t("base.module.channelSettings.notConfigured"),
                onClick: () => {
                  // 延迟获取最新数据
                  const latestData =
                    context.routeData() as ChannelSettingRouteData;
                  const subscriberOfMe = latestData?.subscriberOfMe;
                  const latestChannelInfo = latestData?.channelInfo;

                  // 后端权限字段优先
                  const backendCanEdit =
                    !!latestChannelInfo?.orgData?.thread?.can_edit_thread_md;

                  // 父群群主/管理员
                  const isGroupOwnerOrManager =
                    subscriberOfMe &&
                    (subscriberOfMe.role === 1 || subscriberOfMe.role === 2);

                  // 子区创建者
                  const isThreadCreator =
                    latestChannelInfo?.orgData?.thread?.creator_uid ===
                    WKApp.loginInfo.uid;

                  const canEditMd = !!(
                    backendCanEdit ||
                    isThreadCreator ||
                    isGroupOwnerOrManager
                  );

                  context.push(
                    <GroupMdEditor channel={channel} canEdit={canEditMd} />,
                    new RouteContextConfig({
                      title: "GROUP.md",
                    })
                  );
                },
              },
            }),
          ],
        });
      },
      1000
    );

    // 子区设置说明：
    // - 消息免打扰/聊天置顶：子区继承父群组设置，暂不支持单独配置
    // - 成员管理：子区成员通过加入/离开操作，不支持手动添加
    WKApp.shared.channelSettingRegister(
      "thread.actions",
      (context) => {
        const data = context.routeData() as ChannelSettingRouteData;
        const channel = data.channel;
        if (channel.channelType !== ChannelTypeCommunityTopic) {
          return undefined;
        }
        const threadInfo = parseThreadChannelId(channel.channelID);
        const thread = data.channelInfo?.orgData?.thread as any;
        const isCreator = thread?.creator_uid === WKApp.loginInfo.uid;
        const canArchive = isCreator || data.isManagerOrCreatorOfMe;
        const isArchived = thread?.status === ThreadStatus.Archived;
        const isActive = thread?.status === ThreadStatus.Active;
        const rows = new Array<Row>();

        if (threadInfo && canArchive && (isActive || isArchived)) {
          rows.push(
            new Row({
              cell: ListItemButton,
              properties: {
                title: isArchived
                  ? t("base.module.thread.unarchive")
                  : t("base.module.thread.archive"),
                type: ListItemButtonType.default,
                onClick: () => {
                  const threadDisplayName =
                    thread?.name ||
                    data.channelInfo?.title ||
                    t("base.module.thread.fallbackName");
                  wkConfirm({
                    title: isArchived
                      ? t("base.module.thread.unarchiveConfirmTitle", {
                          values: { name: threadDisplayName },
                        })
                      : t("base.module.thread.archiveConfirmTitle", {
                          values: { name: threadDisplayName },
                        }),
                    okText: isArchived
                      ? t("base.module.thread.unarchive")
                      : t("base.module.thread.archiveOk"),
                    cancelText: t("base.common.cancel"),
                    content: isArchived
                      ? t("base.module.thread.unarchiveConfirmContent")
                      : t("base.module.thread.archiveConfirmContent"),
                    onOk: async () => {
                      try {
                        if (isArchived) {
                          await WKApp.dataSource.channelDataSource.threadUnarchive(
                            threadInfo.groupNo,
                            threadInfo.shortId
                          );
                        } else {
                          await WKApp.dataSource.channelDataSource.threadArchive(
                            threadInfo.groupNo,
                            threadInfo.shortId
                          );
                        }
                        Toast.success(
                          isArchived
                            ? t("base.module.thread.unarchiveSuccess")
                            : t("base.module.thread.archiveSuccess")
                        );
                        WKSDK.shared().channelManager.deleteChannelInfo(
                          channel
                        );
                        await WKSDK.shared().channelManager.fetchChannelInfo(
                          channel
                        );
                        data.refresh();
                      } catch (err: any) {
                        Toast.error(
                          err?.msg ||
                            (isArchived
                              ? t("base.module.thread.unarchiveFailedRetry")
                              : t("base.module.thread.archiveFailedRetry"))
                        );
                      }
                    },
                  });
                },
              },
            })
          );
        }

        rows.push(
          new Row({
            cell: ListItemButton,
            properties: {
              title: t("base.module.thread.leave"),
              type: ListItemButtonType.warn,
              onClick: () => {
                WKApp.shared.baseContext.showAlert({
                  content: t("base.module.thread.leaveConfirm"),
                  onOk: async () => {
                    if (threadInfo) {
                      await WKApp.apiClient
                        .post(`threads/${threadInfo.shortId}/leave`)
                        .catch((err: any) => {
                          Toast.error(
                            err.msg || t("base.module.thread.leaveFailed")
                          );
                        });
                      WKApp.conversationProvider.deleteConversation(
                        data.channel
                      );
                    }
                  },
                });
              },
            },
          })
        );
        return new Section({
          title: t("base.module.thread.management"),
          rows,
        });
      },
      90000
    );
  }
}
