import { ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { updateChannelSettingMyGroupNickname } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingInfoRow } from "../../ui/ChannelSettingRows";
import { ChannelSettingInputEditPush } from "./types";

export function buildMyGroupNicknameSection(
  context: RouteContext<ChannelSettingRouteData>,
  inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (
    data.channel.channelType !== ChannelTypeGroup ||
    isGroupDisbanded(data.channelInfo)
  ) {
    return undefined;
  }

  const displayName = data.subscriberOfMe?.remark || data.subscriberOfMe?.name;

  return new Section({
    rows: [
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: t("base.module.channelSettings.myGroupNickname"),
          value: displayName,
          onClick: () => {
            inputEditPush(
              context,
              displayName || "",
              async (value: string) => {
                await updateChannelSettingMyGroupNickname({
                  channel: data.channel,
                  remark: value,
                });
                if (data.subscriberOfMe) {
                  data.subscriberOfMe.remark = value;
                }
                data.refresh();
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
}
