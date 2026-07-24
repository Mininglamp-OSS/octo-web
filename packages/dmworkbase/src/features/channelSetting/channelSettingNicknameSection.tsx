import { ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { updateChannelSettingMyGroupNickname } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingInlineEditRow } from "../../ui/ChannelSettingRows";
import { ChannelSettingInputEditPush } from "./types";

export function buildMyGroupNicknameSection(
  context: RouteContext<ChannelSettingRouteData>,
  _inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (
    data.channel.channelType !== ChannelTypeGroup ||
    isGroupDisbanded(data.channelInfo)
  ) {
    return undefined;
  }

  const groupNickname = data.subscriberOfMe?.remark ?? "";

  return new Section({
    rows: [
      new Row({
        cell: ChannelSettingInlineEditRow,
        properties: {
          title: t("base.module.channelSettings.myGroupNickname"),
          value: groupNickname,
          displayValue: groupNickname || t("base.common.notSet"),
          placeholder: t(
            "base.module.channelSettings.myGroupNicknamePlaceholder"
          ),
          maxCount: 10,
          allowEmpty: true,
          onSave: async (value: string) => {
            await updateChannelSettingMyGroupNickname({
              channel: data.channel,
              remark: value,
            });
            if (data.subscriberOfMe) {
              data.subscriberOfMe.remark = value;
            }
            data.refresh();
          },
        },
      }),
    ],
  });
}
