import { Toast } from "@douyinfe/semi-ui";
import { ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { GroupRole } from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Dap } from "../../Service/Dap";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import {
  clearChannelSettingMessages,
  exitChannelSettingGroup,
} from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingActionRow } from "../../ui/ChannelSettingRows";

export function buildChannelDangerSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (
    data.channel.channelType !== ChannelTypeGroup ||
    isGroupDisbanded(data.channelInfo)
  ) {
    return undefined;
  }

  return new Section({
    rows: [
      new Row({
        cell: ChannelSettingActionRow,
        trackEvent: "conversation_clear_dialog_opened",
        properties: {
          title: t("base.module.channelSettings.clearMessages"),
          danger: true,
          onClick: () => {
            WKApp.shared.baseContext.showAlert({
              content: t("base.module.channelSettings.clearMessagesConfirm"),
              onOk: async () => {
                await clearChannelSettingMessages({ channel: data.channel });
              },
            });
          },
        },
      }),
      new Row({
        cell: ChannelSettingActionRow,
        properties: {
          title: t("base.module.channelSettings.deleteAndExit"),
          danger: true,
          onClick: () => {
            if (data.subscriberOfMe?.role === GroupRole.owner) {
              WKApp.shared.baseContext.showAlert({
                title: t("base.module.channelSettings.ownerLeaveBlockedTitle"),
                content: t(
                  "base.module.channelSettings.ownerLeaveBlockedContent"
                ),
              });
              return;
            }
            // 命令式上报:仅在真正打开退出确认弹窗时计数;群主分支被上面的 return
            // 拦截,不会误报(见 PR #1390 review P1-1)。
            Dap.shared.track("conversation_leave_dialog_opened");
            WKApp.shared.baseContext.showAlert({
              content: t("base.module.channelSettings.deleteAndExitConfirm"),
              onOk: async () => {
                try {
                  await exitChannelSettingGroup({
                    channel: data.channel,
                    onDeleteConversationError: (error) => {
                      console.warn(
                        "[ChannelSetting] delete conversation after leaving failed:",
                        error
                      );
                    },
                  });
                } catch (error: any) {
                  Toast.error(
                    error?.msg ||
                      t("base.module.channelSettings.deleteAndExitFailed")
                  );
                  throw error;
                }
              },
            });
          },
        },
      }),
    ],
  });
}
