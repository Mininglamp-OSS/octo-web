/**
 * mock-im-runtime — fake WKSDK provider。
 *
 * 覆盖 WKSDK.shared().config.provider 的全部 *Callback,数据完全从 seed 派发。
 * 不发任何真实 HTTP,不连 WebSocket。install 后 IMProvider 视为已 Connected。
 *
 * 与真实 provider (`src/features/base/providers/im-callbacks.ts`) 的关系:
 *   - 真实 provider 走 HTTP + SDK 内部推送
 *   - fake provider 走 seed → 直接构造 SDK model 实例返回
 *   - 唯一 subclass 关系:两者产出的 model 通过同一套 model 类 (ChannelInfo /
 *     Conversation / Message 等),所以业务 selector / listener 对二者透明。
 *
 * install 流程 (main.tsx 里 VITE_E2E_MOCK_IM=1 触发):
 *   1. WKSDK.shared().config.provider = fakeProvider(seed)
 *   2. WKSDK.shared().connectManager.status = Connected
 *   3. queueMicrotask(() => notifyConnectStatusListeners(0))
 *      让 IMProvider useImConnection 里的 status listener 收到 Connected → 业务
 *      认为已连接,"连接中"文案消失。
 *
 * seed 更新:test 里可以通过 window.__mockImUpdateSeed__(partial) 补数据,
 * 但暂不实装 —— C6 用 install 一次性喂完足够。P1+ 遇到"要往已连接的 SDK 里补
 * seed"再加。
 */
/* eslint-disable no-undef -- e2e code, window/globalThis available */
/* eslint-disable @typescript-eslint/no-explicit-any -- SDK provider signature 用了大量 any */

import WKSDK, {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
  ChannelTypePerson,
  ConnectStatus,
  Conversation,
  Message,
  MessageText,
  Subscriber,
} from "wukongimjssdk";
import type {
  MockConversationSeed,
  MockGroupSeed,
  MockMessageSeed,
  MockSeed,
  MockSubscriberSeed,
  MockUserSeed,
} from "./seed-types";

function groupToChannelInfo(g: MockGroupSeed, spaceId: string): ChannelInfo {
  const info = new ChannelInfo();
  info.channel = new Channel(g.group_no, ChannelTypeGroup);
  info.title = g.name;
  info.mute = g.mute === 1;
  info.top = g.top === 1;
  info.logo = g.logo && g.logo !== "" ? g.logo : `groups/${g.group_no}/avatar`;
  const orgData: Record<string, unknown> = { ...g.extra };
  orgData.remark = g.remark ?? "";
  orgData.displayName = g.remark && g.remark !== "" ? g.remark : g.name;
  orgData.space_id = spaceId;
  info.orgData = orgData;
  return info;
}

function userToChannelInfo(u: MockUserSeed): ChannelInfo {
  const info = new ChannelInfo();
  info.channel = new Channel(u.uid, ChannelTypePerson);
  info.title = u.name;
  info.logo = u.logo && u.logo !== "" ? u.logo : `users/${u.uid}/avatar`;
  const orgData: Record<string, unknown> = { ...u.extra };
  orgData.remark = u.remark ?? "";
  orgData.realname_verified = u.realname_verified ?? 0;
  orgData.real_name = u.real_name ?? "";
  orgData.short_no = u.short_no ?? "";
  orgData.robot = u.robot ?? 0;
  orgData.online = u.online;
  orgData.last_offline = u.last_offline;
  orgData.displayName = u.remark && u.remark !== "" ? u.remark : u.name;
  info.online = u.online === 1;
  info.lastOffline = u.last_offline ?? 0;
  info.orgData = orgData;
  return info;
}

function toConversation(c: MockConversationSeed): Conversation {
  const conv = new Conversation();
  conv.channel = new Channel(c.channelId, c.channelType);
  conv.unread = c.unread ?? 0;
  conv.timestamp = c.timestamp ?? 0;
  (conv as any).extra = {
    top: c.stick ?? 0,
    categoryId: c.categoryId ?? null,
    categorySort: c.categorySort ?? 0,
  };
  return conv;
}

function toMessage(m: MockMessageSeed): Message {
  const msg = new Message();
  msg.channel = new Channel(m.channelId, m.channelType);
  msg.messageSeq = m.messageSeq;
  msg.fromUID = m.fromUid;
  msg.timestamp = m.timestamp ?? Math.floor(Date.now() / 1000);
  msg.messageID = `mock-${m.channelId}-${m.messageSeq}`;
  // clientMsgNo 必须唯一——业务(chat-selection、fold-session、reply 等)都用它做
  // Map/Set key。SDK 默认 Message 构造赋 uuid,但 fake provider 直连 setter 后
  // 有时不覆盖(SDK 内部初值可能就是空串或同 uuid)。这里强制唯一。
  msg.clientMsgNo = `mock-${m.channelId}-${m.messageSeq}`;
  // 默认走 MessageText;seed 里如果传 type=其它,test 侧自己处理 renderer
  if (m.content.type === 1 && typeof m.content.text === "string") {
    const c = new MessageText();
    c.text = m.content.text;
    msg.content = c;
  } else {
    (msg as any).content = m.content;
  }
  return msg;
}

function toSubscriber(s: MockSubscriberSeed): Subscriber {
  const sub = new Subscriber();
  sub.uid = s.uid;
  (sub as any).name = s.name ?? s.uid;
  (sub as any).role = s.role ?? 0;
  (sub as any).version = 1; // 增量 sync 需要,SDK 内部读 lastMember.version
  (sub as any).orgData = { ...s.orgData, robot: s.robot ?? 0 };
  return sub;
}

/**
 * install fake provider + short-circuit 到 Connected。
 * 幂等:重复 install 直接覆盖旧 provider + seed（test 之间隔离用）。
 */
export function installFakeProvider(seed: MockSeed): void {
  const sdk = WKSDK.shared();
  const cm = sdk.channelManager;

  // 1. groups[] / users[] 预热到 channelInfoCache — 侧栏立刻显示真名,不用等 fetch
  for (const g of seed.groups) cm.setChannleInfoForCache(groupToChannelInfo(g, seed.spaceId));
  for (const u of seed.users) cm.setChannleInfoForCache(userToChannelInfo(u));

  // 2. subscribers 索引 —— 不预塞 subscribeCacheMap,让业务侧调 syncSubscribes
  //    时经 syncSubscribersCallback 走 SDK 标准流程（append + notify listener）。
  const subsByChannel = new Map<string, Subscriber[]>();
  for (const s of seed.subscribers ?? []) {
    const key = `${s.channelId}-${s.channelType}`;
    const list = subsByChannel.get(key) ?? [];
    list.push(toSubscriber(s));
    subsByChannel.set(key, list);
  }

  // 3. 覆盖 provider 全部 callback
  const provider = sdk.config.provider;

  provider.syncConversationsCallback = async () => seed.conversations.map(toConversation);

  provider.syncConversationExtrasCallback = async () => [];

  provider.channelInfoCallback = async (channel: Channel): Promise<ChannelInfo> => {
    // groups + users 已在 cache 里,fetchChannelInfo 命中 cache 后不会走 callback;
    // 走到这里说明 seed 没覆盖 —— 返一个 fallback,避免业务写空 ChannelInfo。
    const g = seed.groups.find((x) => x.group_no === channel.channelID);
    if (g) return groupToChannelInfo(g, seed.spaceId);
    const u = seed.users.find((x) => x.uid === channel.channelID);
    if (u) return userToChannelInfo(u);
    const fallback = new ChannelInfo();
    fallback.channel = channel;
    fallback.title = channel.channelID;
    return fallback;
  };

  provider.syncSubscribersCallback = async (channel: Channel) => {
    const key = `${channel.channelID}-${channel.channelType}`;
    return subsByChannel.get(key) ?? [];
  };

  provider.syncMessagesCallback = async (channel: Channel, opts: any) => {
    // 分页派发:
    //   startSeq == 0 && endSeq == 0  → 返最新一页 (Down 语义: SDK 首屏)
    //   startSeq > 0  && endSeq == 0  → 返 seq < startSeq 的更老一页 (SDK 翻旧页)
    //   startSeq >= 0 && endSeq > 0   → 返 [startSeq, endSeq] 区间内的消息
    //                                    (locate-reply-message 双向窗口, 修完 bug 后走这个分支)
    // pullMode 忽略: 前端仍传 Down/Up, 但真实后端 server 也常 echo pullMode=0 无视传入值,
    //                我们按 seq range 语义派发, 是对齐后端真实行为的最小 mock。
    const limit = (opts?.limit as number) ?? 30;
    const startSeq = (opts?.startMessageSeq as number) ?? 0;
    const endSeq = (opts?.endMessageSeq as number) ?? 0;
    const allForChannel = (seed.messages ?? []).filter(
      (m) => m.channelId === channel.channelID && m.channelType === channel.channelType,
    );
    let filtered: typeof allForChannel;
    if (endSeq > 0) {
      // 双向窗口: 明确的 [startSeq, endSeq] 区间, 按 seq 升序返 (客户端会自排, 但保序更少歧义)
      filtered = allForChannel
        .filter((m) => m.messageSeq >= startSeq && m.messageSeq <= endSeq)
        .sort((a, b) => a.messageSeq - b.messageSeq);
    } else if (startSeq === 0) {
      // 首屏: 最新一页 (新到老)
      filtered = allForChannel.sort((a, b) => b.messageSeq - a.messageSeq);
    } else {
      // 翻更老: seq < startSeq (新到老)
      filtered = allForChannel
        .filter((m) => m.messageSeq < startSeq)
        .sort((a, b) => b.messageSeq - a.messageSeq);
    }
    const page = filtered.slice(0, limit).map(toMessage);
    // spy log 供 test 断言 (start/end/limit/返 seq 集)
    const log = (window as unknown as { __mockImSyncMessageLog__?: Array<Record<string, unknown>> })
      .__mockImSyncMessageLog__;
    if (log) {
      log.push({
        channelId: channel.channelID,
        channelType: channel.channelType,
        startMessageSeq: startSeq,
        endMessageSeq: endSeq,
        limit,
        returnedSeqs: page.map((m) => m.messageSeq),
      });
    }
    return page;
  };

  provider.syncMessageExtraCallback = async () => [];
  provider.syncRemindersCallback = async () => [];
  provider.reminderDoneCallback = async () => undefined;
  provider.messageReadedCallback = async () => undefined;

  // 4. short-circuit connect → Connected
  const conn = sdk.connectManager;
  // SDK 内部 status 是 setter,直接赋值可能被拦;这里保留标准 assign
  (conn as any).status = ConnectStatus.Connected;
  // 让当前 microtask 结束、IMProvider 挂完 listener 后再 notify
  queueMicrotask(() => conn.notifyConnectStatusListeners(0));

  // 5. hook 到 window,让 baseline main.tsx 可以再拉 seed 更新（P1+）
  (window as any).__mockImSeed__ = seed;
  // spy: 初始化 syncMessages 调用日志（test 断言分页请求语义用）
  if (!(window as unknown as { __mockImSyncMessageLog__?: unknown[] }).__mockImSyncMessageLog__) {
    (window as unknown as { __mockImSyncMessageLog__: unknown[] }).__mockImSyncMessageLog__ = [];
  } else {
    (window as unknown as { __mockImSyncMessageLog__: unknown[] }).__mockImSyncMessageLog__.length =
      0;
  }
}
