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

export function canRemoveChannelSettingSubscriber(params: {
  viewerUid?: string;
  viewerRole?: number;
  subscriber: Subscriber;
}) {
  const { viewerUid, viewerRole = GroupRole.normal, subscriber } = params;
  if (!subscriber?.uid) return false;
  if (subscriber.uid === viewerUid) return false;
  if (subscriber.role === GroupRole.owner) return false;
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

  return new Section({
    rows: [
      new Row({
        cell: Subscribers,
        properties: {
          context,
          channel,
          key: channel.getChannelKey(),
          canManageBotAdmin: !!data.channelInfo?.orgData?.can_manage_bot_admin,
          onRemove: () => {
            context.push(
              <SubscriberList
                channel={channel}
                removeAction={{
                  canRemove: (subscriber) =>
                    canRemoveChannelSettingSubscriber({
                      viewerUid: data.subscriberOfMe?.uid || WKApp.loginInfo.uid,
                      viewerRole: data.subscriberOfMe?.role,
                      subscriber,
                    }),
                  onRemove: (subscriber) =>
                    removeChannelSettingSubscribers({
                      channel,
                      uids: [subscriber.uid],
                    }),
                }}
              />,
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
