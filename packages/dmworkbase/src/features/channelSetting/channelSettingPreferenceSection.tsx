import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelInfo, ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { ListItemSwitchContext } from "../../Components/ListItem";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
} from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import {
  isEffectivelyMuted,
  parseThreadChannelId,
  ThreadStatus,
} from "../../Service/Thread";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import {
  muteChannelSetting,
  saveChannelSetting,
  topChannelSetting,
} from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import {
  ChannelSettingInfoRow,
  ChannelSettingToggleRow,
} from "../../ui/ChannelSettingRows";
import { getCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";

function hasLoadedParentChannelInfo(channelInfo?: ChannelInfo) {
  return (
    !!channelInfo?.orgData && Object.keys(channelInfo.orgData).length > 0
  );
}

export function buildChannelPreferenceSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channelInfo = data.channelInfo;
  const channel = data.channel;
  const rows = new Array<Row>();

  if (channel.channelType === ChannelTypeCustomerService) {
    return undefined;
  }

  if (channel.channelType === ChannelTypeCommunityTopic) {
    const threadInfo = parseThreadChannelId(channel.channelID);
    const thread = channelInfo?.orgData?.thread;
    if (!threadInfo || thread?.status !== ThreadStatus.Active) {
      return undefined;
    }

    const parentChannel = new Channel(threadInfo.groupNo, ChannelTypeGroup);
    const parentChannelInfo = getCurrentImChannelInfo<Channel, ChannelInfo>(
      parentChannel
    );
    if (!hasLoadedParentChannelInfo(parentChannelInfo)) {
      return new Section({
        rows: [
          new Row({
            cell: ChannelSettingInfoRow,
            properties: {
              title: t("base.module.channelSettings.mute"),
              value: t("base.module.thread.muteParentUnavailable"),
            },
          }),
        ],
      });
    }
    if (isGroupDisbanded(parentChannelInfo)) {
      return undefined;
    }

    if (parentChannelInfo.mute) {
      return new Section({
        rows: [
          new Row({
            cell: ChannelSettingInfoRow,
            properties: {
              title: t("base.module.channelSettings.mute"),
              value: t("base.module.thread.muteInheritedOn"),
            },
          }),
        ],
      });
    }

    const threadMuted = isEffectivelyMuted({
      isThread: true,
      channelInfo,
      parentChannelInfo,
    });

    return new Section({
      rows: [
        new Row({
          cell: ChannelSettingToggleRow,
          properties: {
            title: t("base.module.channelSettings.mute"),
            subTitle: t("base.module.thread.muteInheritHint"),
            checked: threadMuted,
            onChange: (value: boolean, row: ListItemSwitchContext) => {
              row.loading = true;
              muteChannelSetting({ channel, mute: value })
                .then(() => data.refresh())
                .catch((error) =>
                  Toast.error(
                    error?.msg || t("base.channelSetting.toggleFailed")
                  )
                )
                .finally(() => {
                  row.loading = false;
                });
            },
          },
        }),
      ],
    });
  }

  if (!isGroupDisbanded(channelInfo)) {
    rows.push(
      new Row({
        cell: ChannelSettingToggleRow,
        properties: {
          title: t("base.module.channelSettings.mute"),
          checked: channelInfo?.mute,
          onChange: (value: boolean, row: ListItemSwitchContext) => {
            row.loading = true;
            muteChannelSetting({ channel, mute: value })
              .then(() => data.refresh())
              .catch((error) => Toast.error(error?.msg))
              .finally(() => {
                row.loading = false;
              });
          },
        },
      })
    );
  }

  rows.push(
    new Row({
      cell: ChannelSettingToggleRow,
      properties: {
        title: t("base.module.channelSettings.pin"),
        checked: channelInfo?.top,
        onChange: (value: boolean, row: ListItemSwitchContext) => {
          row.loading = true;
          topChannelSetting({ channel, top: value })
            .then(() => data.refresh())
            .catch((error) => Toast.error(error?.msg))
            .finally(() => {
              row.loading = false;
            });
        },
      },
    })
  );

  if (channel.channelType === ChannelTypeGroup) {
    rows.push(
      new Row({
        cell: ChannelSettingToggleRow,
        properties: {
          title: t("base.module.channelSettings.saveToContacts"),
          checked: channelInfo?.orgData.save === 1,
          onChange: (value: boolean, row: ListItemSwitchContext) => {
            row.loading = true;
            saveChannelSetting({ channel, save: value })
              .then(() => data.refresh())
              .catch((error) => Toast.error(error?.msg))
              .finally(() => {
                row.loading = false;
              });
          },
        },
      })
    );
  }

  return new Section({ rows });
}
