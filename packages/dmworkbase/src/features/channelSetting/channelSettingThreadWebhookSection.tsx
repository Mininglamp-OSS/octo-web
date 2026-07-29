import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import ChannelWebhookPanel from "../../Components/ChannelWebhook";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { parseThreadChannelId, ThreadStatus } from "../../Service/Thread";
import { isParentGroupManager } from "../../Service/threadPermission";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import { I18nText, t } from "../../i18n";
import { ChannelSettingInfoRow } from "../../ui/ChannelSettingRows";

export function buildThreadWebhookSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const { channel } = data;
  if (channel.channelType !== ChannelTypeCommunityTopic) return undefined;
  const threadInfo = parseThreadChannelId(channel.channelID);
  if (!threadInfo) return undefined;
  const thread = data.channelInfo?.orgData?.thread as any;
  if (thread?.status !== ThreadStatus.Active) return undefined;
  const parentChannel = new Channel(threadInfo.groupNo, ChannelTypeGroup);
  if (isChannelDisbanded(parentChannel)) return undefined;

  return new Section({
    rows: [
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: t("base.threadPanel.webhook"),
          onClick: () => {
            context.push(
              <ChannelWebhookPanel
                channel={parentChannel}
                isManager={isParentGroupManager(threadInfo.groupNo)}
                threadShortId={threadInfo.shortId}
              />,
              new RouteContextConfig({
                title: <I18nText k="base.threadPanel.webhook" />,
              })
            );
          },
        },
      }),
    ],
  });
}
