import { Toast } from "@douyinfe/semi-ui";
import { ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { ListItemSwitchContext } from "../../Components/ListItem";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
} from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import {
  muteChannelSetting,
  saveChannelSetting,
  topChannelSetting,
} from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingToggleRow } from "../../ui/ChannelSettingRows";
import { fetchCurrentImChannelInfo } from "../../im-runtime/currentChannelRuntime";

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
    const thread = channelInfo?.orgData?.thread;
    const threadMuted = thread?.mute === 1;

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
                .then(() => fetchCurrentImChannelInfo(channel))
                .then(() => data.refresh())
                .catch((error) => Toast.error(error?.msg))
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
