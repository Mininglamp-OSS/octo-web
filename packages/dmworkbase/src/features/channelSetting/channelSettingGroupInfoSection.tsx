import { ChannelTypeGroup } from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import RouteContext from "../../Service/Context";
import { Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { buildGroupManagementRows } from "./channelSettingGroupManagementRows";
import { buildGroupProfileRows } from "./channelSettingGroupProfileRows";
import { ChannelSettingTextEditPush } from "./types";

export function buildChannelGroupInfoSection(
  context: RouteContext<ChannelSettingRouteData>,
  textEditPush: ChannelSettingTextEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (data.channel.channelType !== ChannelTypeGroup) {
    return undefined;
  }

  const disbanded = isGroupDisbanded(data.channelInfo);
  return new Section({
    rows: [
      ...buildGroupProfileRows({ context, data, textEditPush, disbanded }),
      ...buildGroupManagementRows({ context, data, textEditPush, disbanded }),
    ],
  });
}
