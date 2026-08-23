import { Subscriber } from "wukongimjssdk";
import React from "react";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { Subscribers } from "../../Components/Subscribers";
import { SubscriberList } from "../../Components/Subscribers/list";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
  GroupRole,
} from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import { removeChannelSettingSubscribers } from "../../bridge/channelSetting/channelSettingActions";
import WKApp from "../../App";

/**
 * 当前查看者是否拥有这个 bot 成员（octo-web#1511）。
 *
 * 数据来自成员列表下发的 `bot_owned_by_me`，后端按 per-viewer 计算。
 * **必须 fail closed**：/membersync 是按 version 的增量同步，该字段上线前已缓存的
 * 成员行在其 version 变动前不会带上它。缺失 / 非严格 true 一律按「不拥有」处理，
 * 降级方向是退回改动前的行为，绝不能误开移除权限。
 */
function isBotOwnedByViewer(subscriber: Subscriber): boolean {
  return subscriber?.orgData?.bot_owned_by_me === true;
}

export function canRemoveChannelSettingSubscriber(params: {
  viewerUid?: string;
  viewerRole?: number;
  subscriber: Subscriber;
}) {
  const { viewerUid, viewerRole = GroupRole.normal, subscriber } = params;
  if (!subscriber?.uid) return false;
  if (subscriber.uid === viewerUid) return false;
  if (subscriber.role === GroupRole.owner) return false;
  // 自助移除（octo-web#1511）：不论查看者在群里是什么角色，都可以撤走自己名下的
  // bot。放在角色判断之前，是因为普通成员的角色分支恒 false，会把这条挡掉。
  // 上面两条否决保持优先：不能移除自己，也不能移除群主（即便群主是个 bot）。
  if (isBotOwnedByViewer(subscriber)) return true;
  if (viewerRole === GroupRole.owner) return true;
  if (viewerRole === GroupRole.manager) {
    return subscriber.role === GroupRole.normal;
  }
  return false;
}

export function buildChannelMembersSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;

  if (
    channel.channelType === ChannelTypeCustomerService ||
    channel.channelType === ChannelTypeCommunityTopic
  ) {
    return undefined;
  }

  if (isGroupDisbanded(data.channelInfo)) {
    return undefined;
  }

  // 同一个 removeAction 同时供两条进入成员列表的路径使用：
  //   1. 群主/管理员点「移除成员」图标（下面的 onRemove）
  //   2. 任何成员点「查看全部」（Subscribers 内部，见 Components/Subscribers/index.tsx）
  // 路径 2 以前不带 removeAction，导致普通成员即使拥有某个 bot 也看不到任何移除入口
  // （octo-web#1511）。逐行是否显示由 canRemove 判定，故对无 bot 的普通成员是无变化的。
  const removeAction = {
    canRemove: (subscriber: Subscriber) =>
      canRemoveChannelSettingSubscriber({
        viewerUid: data.subscriberOfMe?.uid || WKApp.loginInfo.uid,
        viewerRole: data.subscriberOfMe?.role,
        subscriber,
      }),
    onRemove: (subscriber: Subscriber) =>
      removeChannelSettingSubscribers({
        channel,
        uids: [subscriber.uid],
      }),
  };

  return new Section({
    rows: [
      new Row({
        cell: Subscribers,
        properties: {
          context,
          channel,
          key: channel.getChannelKey(),
          canManageBotAdmin: !!data.channelInfo?.orgData?.can_manage_bot_admin,
          removeAction,
          onRemove: () => {
            context.push(
              <SubscriberList channel={channel} removeAction={removeAction} />,
              {
                title: (
                  <span className="wk-subscrierlist-title-inline">
                    <span className="wk-subscrierlist-title-label">
                      {t("base.subscribers.groupMembersWithCount", {
                        values: {
                          count:
                            data.channelInfo?.orgData?.member_count ||
                            data.subscribers.length,
                        },
                      })}
                    </span>
                    {WKApp.endpoints.organizationalTool(
                      channel,
                      <button
                        type="button"
                        className="wk-subscrierlist-title-add"
                      >
                        {t("base.subscribers.addMember")}
                      </button>
                    )}
                  </span>
                ),
              }
            );
          },
        },
      }),
    ],
  });
}
