import { Channel, ChannelTypeGroup, WKSDK } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingManager } from "../../Service/ChannelSetting";
import { EndpointID } from "../../Service/Const";
import { ChannelField } from "../../Service/DataSource/DataSource";
import {
  deleteCurrentImChannelInfo,
  fetchCurrentImChannelInfo,
  syncCurrentImChannelSubscribers,
} from "../../im-runtime/currentChannelRuntime";

export interface ChannelSettingActionRuntime {
  addSubscribers(channel: Channel, uids: string[]): Promise<void>;
  clearConversationMessages(conversation: any): Promise<void>;
  createChannel(uids: string[]): Promise<{ group_no?: string } | undefined>;
  deleteConversation(channel: Channel): Promise<void>;
  deleteCurrentChannelInfo(channel: Channel): void;
  exitChannel(channel: Channel): Promise<void>;
  fetchCurrentChannelInfo(channel: Channel): Promise<any>;
  findConversation(channel: Channel): any | undefined;
  getLoginUid(): string | undefined;
  invokeClearChannelMessages(channel: Channel): void;
  leaveThread(shortId: string): Promise<void>;
  muteChannel(channel: Channel, mute: boolean): Promise<void>;
  removeLocalConversationAndCloseIfOpen(channel: Channel): void;
  removeSubscribers(channel: Channel, uids: string[]): Promise<void>;
  remarkChannel(channel: Channel, remark: string): Promise<void>;
  saveChannel(channel: Channel, save: boolean): Promise<void>;
  showConversation(channel: Channel): void;
  syncCurrentChannelSubscribers(channel: Channel): Promise<any>;
  topChannel(channel: Channel, top: boolean): Promise<void>;
  transferOwner(channel: Channel, uid: string): Promise<void>;
  updateChannelField(
    channel: Channel,
    field: ChannelField,
    value: string
  ): Promise<void>;
  updateSubscriberAttr(
    channel: Channel,
    uid: string,
    attr: Record<string, any>
  ): Promise<void>;
  updateThread(
    groupNo: string,
    shortId: string,
    data: Record<string, any>
  ): Promise<void>;
}

function defaultRuntime(): ChannelSettingActionRuntime {
  return {
    addSubscribers(channel, uids) {
      return WKApp.dataSource.channelDataSource.addSubscribers(channel, uids);
    },
    clearConversationMessages(conversation) {
      return WKApp.conversationProvider.clearConversationMessages(conversation);
    },
    createChannel(uids) {
      return WKApp.dataSource.channelDataSource.createChannel(uids);
    },
    deleteConversation(channel) {
      return WKApp.conversationProvider.deleteConversation(channel);
    },
    deleteCurrentChannelInfo(channel) {
      deleteCurrentImChannelInfo(channel);
    },
    exitChannel(channel) {
      return WKApp.dataSource.channelDataSource.exitChannel(channel);
    },
    fetchCurrentChannelInfo(channel) {
      return fetchCurrentImChannelInfo(channel);
    },
    findConversation(channel) {
      return WKSDK.shared().conversationManager.findConversation(channel);
    },
    getLoginUid() {
      return WKApp.loginInfo.uid;
    },
    invokeClearChannelMessages(channel) {
      WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, channel);
    },
    leaveThread(shortId) {
      return WKApp.apiClient.post(`threads/${shortId}/leave`);
    },
    muteChannel(channel, mute) {
      return ChannelSettingManager.shared.mute(mute, channel);
    },
    removeLocalConversationAndCloseIfOpen(channel) {
      WKSDK.shared().conversationManager.removeConversation(channel);
      const isOpen = WKApp.shared.openChannel?.isEqual(channel);
      if (isOpen) {
        WKApp.shared.openChannel = undefined;
        WKApp.routeRight.popToRoot();
      }
      WKApp.shared.notifyListener();
    },
    removeSubscribers(channel, uids) {
      return WKApp.dataSource.channelDataSource.removeSubscribers(channel, uids);
    },
    remarkChannel(channel, remark) {
      return ChannelSettingManager.shared.remark(remark, channel);
    },
    saveChannel(channel, save) {
      return ChannelSettingManager.shared.save(save, channel);
    },
    showConversation(channel) {
      WKApp.endpoints.showConversation(channel);
    },
    syncCurrentChannelSubscribers(channel) {
      return syncCurrentImChannelSubscribers(channel);
    },
    topChannel(channel, top) {
      return ChannelSettingManager.shared.top(top, channel);
    },
    transferOwner(channel, uid) {
      return WKApp.dataSource.channelDataSource.channelTransferOwner(
        channel,
        uid
      );
    },
    updateChannelField(channel, field, value) {
      return WKApp.dataSource.channelDataSource.updateField(
        channel,
        field,
        value
      );
    },
    updateSubscriberAttr(channel, uid, attr) {
      return WKApp.dataSource.channelDataSource.subscriberAttrUpdate(
        channel,
        uid,
        attr
      );
    },
    updateThread(groupNo, shortId, data) {
      return WKApp.dataSource.channelDataSource.threadUpdate(
        groupNo,
        shortId,
        data
      );
    },
  };
}

function runtimeOrDefault(runtime?: ChannelSettingActionRuntime) {
  return runtime ?? defaultRuntime();
}

export async function addChannelSettingSubscribers(params: {
  channel: Channel;
  uids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).addSubscribers(
    params.channel,
    params.uids
  );
}

export async function createGroupFromChannelSettingPrivateChat(params: {
  channel: Channel;
  selectedUids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  const result = await runtime.createChannel([
    runtime.getLoginUid() || "",
    params.channel.channelID,
    ...params.selectedUids,
  ]);
  if (result?.group_no) {
    runtime.showConversation(new Channel(result.group_no, ChannelTypeGroup));
  }
  return result;
}

export async function removeChannelSettingSubscribers(params: {
  channel: Channel;
  uids: string[];
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).removeSubscribers(
    params.channel,
    params.uids
  );
}

export async function updateChannelSettingField(params: {
  channel: Channel;
  field: ChannelField;
  value: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).updateChannelField(
    params.channel,
    params.field,
    params.value
  );
}

export async function muteChannelSetting(params: {
  channel: Channel;
  mute: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).muteChannel(
    params.channel,
    params.mute
  );
}

export async function topChannelSetting(params: {
  channel: Channel;
  top: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).topChannel(params.channel, params.top);
}

export async function saveChannelSetting(params: {
  channel: Channel;
  save: boolean;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).saveChannel(
    params.channel,
    params.save
  );
}

export async function remarkChannelSetting(params: {
  channel: Channel;
  remark: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  await runtimeOrDefault(params.runtime).remarkChannel(
    params.channel,
    params.remark
  );
}

export async function transferChannelSettingOwner(params: {
  channel: Channel;
  uid: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.transferOwner(params.channel, params.uid);
  void runtime.syncCurrentChannelSubscribers(params.channel);
  void runtime.fetchCurrentChannelInfo(params.channel);
}

export async function updateChannelSettingMyGroupNickname(params: {
  channel: Channel;
  remark: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.updateSubscriberAttr(
    params.channel,
    runtime.getLoginUid() || "",
    { remark: params.remark }
  );
}

export async function clearChannelSettingMessages(params: {
  channel: Channel;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  const conversation = runtime.findConversation(params.channel);
  if (!conversation) {
    return;
  }
  await runtime.clearConversationMessages(conversation);
  conversation.lastMessage = undefined;
  runtime.invokeClearChannelMessages(params.channel);
}

export async function exitChannelSettingGroup(params: {
  channel: Channel;
  onDeleteConversationError?: (err: any) => void;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.exitChannel(params.channel);
  await runtime.deleteConversation(params.channel).catch((err) => {
    params.onDeleteConversationError?.(err);
  });
  runtime.removeLocalConversationAndCloseIfOpen(params.channel);
}

export async function updateChannelSettingThreadName(params: {
  channel: Channel;
  groupNo: string;
  shortId: string;
  name: string;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.updateThread(params.groupNo, params.shortId, {
    name: params.name,
  });
  runtime.deleteCurrentChannelInfo(params.channel);
  await runtime.fetchCurrentChannelInfo(params.channel);
}

export async function leaveChannelSettingThread(params: {
  channel: Channel;
  shortId: string;
  onDeleteConversationError?: (err: any) => void;
  runtime?: ChannelSettingActionRuntime;
}) {
  const runtime = runtimeOrDefault(params.runtime);
  await runtime.leaveThread(params.shortId);
  await runtime.deleteConversation(params.channel).catch((err) => {
    params.onDeleteConversationError?.(err);
  });
  runtime.removeLocalConversationAndCloseIfOpen(params.channel);
}
