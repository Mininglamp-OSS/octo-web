import { Subscriber } from "wukongimjssdk";
import React from "react";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { Subscribers } from "../../Components/Subscribers";
import { SubscriberList } from "../../Components/Subscribers/list";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
} from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import { removeChannelSettingSubscribers } from "../../bridge/channelSetting/channelSettingActions";
import { canRemoveChannelSettingSubscriber as canRemoveSubscriber } from "./memberRemovalPermission";
import WKApp from "../../App";

// 判定逻辑住在零依赖的叶子模块里，好让 Components/Subscribers/vm.ts 也能复用
// （直接互相 import 会成环）。此处 re-export 保持既有引用路径不变。
export {
  canRemoveChannelSettingSubscriber,
  isBotOwnedByViewer,
} from "./memberRemovalPermission";

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
      canRemoveSubscriber({
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
