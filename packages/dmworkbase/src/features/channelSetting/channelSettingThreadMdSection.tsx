import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { GroupMdEditor } from "../../Components/GroupMdEditor";
import { ChannelTypeCommunityTopic, GroupRole } from "../../Service/Const";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { parseThreadChannelId } from "../../Service/Thread";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import { ChannelSettingInfoRow } from "../../ui/ChannelSettingRows";

export function buildThreadMdSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const { channel, channelInfo } = data;
  if (channel.channelType !== ChannelTypeCommunityTopic) return undefined;
  const threadInfo = parseThreadChannelId(channel.channelID);
  if (
    !threadInfo ||
    isChannelDisbanded(new Channel(threadInfo.groupNo, ChannelTypeGroup))
  ) {
    return undefined;
  }

  const hasThreadMd = channelInfo?.orgData?.has_thread_md;
  const mdVersion = channelInfo?.orgData?.thread_md_version || 0;
  return new Section({
    rows: [
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: "GROUP.md",
          value: hasThreadMd
            ? t("base.module.channelSettings.configuredVersion", {
                values: { version: mdVersion },
              })
            : t("base.module.channelSettings.notConfigured"),
          onClick: () => {
            const latest = context.routeData() as ChannelSettingRouteData;
            const me = latest.subscriberOfMe;
            const thread = latest.channelInfo?.orgData?.thread;
            const canEdit =
              !!thread?.can_edit_thread_md ||
              thread?.creator_uid === WKApp.loginInfo.uid ||
              me?.role === GroupRole.owner ||
              me?.role === GroupRole.manager;
            context.push(
              <GroupMdEditor channel={channel} canEdit={canEdit} />,
              new RouteContextConfig({ title: "GROUP.md" })
            );
          },
        },
      }),
    ],
  });
}
