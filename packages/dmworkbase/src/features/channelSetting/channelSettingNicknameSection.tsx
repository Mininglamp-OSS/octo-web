import { Toast } from "@douyinfe/semi-ui";
import { ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { updateChannelSettingMyGroupNickname } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingInlineEditRow } from "../../ui/ChannelSettingRows";
import { ChannelSettingTextEditPush } from "./types";

export function buildMyGroupNicknameSection(
  context: RouteContext<ChannelSettingRouteData>,
  _textEditPush: ChannelSettingTextEditPush
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
          trackEvent: "group_nickname_edit_opened",
          maxCount: 10,
          allowEmpty: true,
          onSave: async (value: string) => {
            try {
              await updateChannelSettingMyGroupNickname({
                channel: data.channel,
                remark: value,
              });
            } catch (error) {
              const message =
                typeof error === "object" &&
                error !== null &&
                "msg" in error &&
                typeof error.msg === "string"
                  ? error.msg
                  : t("base.module.channelSettings.saveFailedRetry");
              Toast.error(message);
              return false;
            }
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
