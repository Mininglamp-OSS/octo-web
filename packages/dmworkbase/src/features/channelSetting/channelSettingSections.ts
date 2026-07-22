import { Toast } from "@douyinfe/semi-ui";
import { ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import {
  ListItem,
  ListItemButton,
  ListItemButtonType,
  ListItemSwitch,
  ListItemSwitchContext,
} from "../../Components/ListItem";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
  GroupRole,
} from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import {
  clearChannelSettingMessages,
  exitChannelSettingGroup,
  muteChannelSetting,
  saveChannelSetting,
  topChannelSetting,
  updateChannelSettingMyGroupNickname,
} from "../../bridge/channelSetting/channelSettingActions";

export type ChannelSettingInputEditPush = (
  context: RouteContext<any>,
  defaultValue: string,
  onFinish: (value: string) => Promise<void>,
  placeholder?: string,
  maxCount?: number,
  allowEmpty?: boolean,
  allowWrap?: boolean
) => void;

export function buildChannelPreferenceSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channelInfo = data.channelInfo;
  const channel = data.channel;
  const rows = new Array<Row>();

  if (
    channel.channelType === ChannelTypeCustomerService ||
    channel.channelType === ChannelTypeCommunityTopic
  ) {
    return undefined;
  }

  const disbanded = isGroupDisbanded(channelInfo);

  if (!disbanded) {
    rows.push(
      new Row({
        cell: ListItemSwitch,
        properties: {
          title: t("base.module.channelSettings.mute"),
          checked: channelInfo?.mute,
          onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
            ctx.loading = true;
            muteChannelSetting({ channel, mute: v })
              .then(() => {
                ctx.loading = false;
                data.refresh();
              })
              .catch(() => {
                ctx.loading = false;
              });
          },
        },
      })
    );
  }

  rows.push(
    new Row({
      cell: ListItemSwitch,
      properties: {
        title: t("base.module.channelSettings.pin"),
        checked: channelInfo?.top,
        onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
          ctx.loading = true;
          topChannelSetting({ channel, top: v })
            .then(() => {
              ctx.loading = false;
              data.refresh();
            })
            .catch(() => {
              ctx.loading = false;
            });
        },
      },
    })
  );

  if (channel.channelType === ChannelTypeGroup) {
    rows.push(
      new Row({
        cell: ListItemSwitch,
        properties: {
          title: t("base.module.channelSettings.saveToContacts"),
          checked: channelInfo?.orgData.save === 1,
          onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
            ctx.loading = true;
            saveChannelSetting({ channel, save: v })
              .then(() => {
                ctx.loading = false;
                data.refresh();
              })
              .catch(() => {
                ctx.loading = false;
              });
          },
        },
      })
    );
  }

  return new Section({
    rows,
  });
}

export function buildMyGroupNicknameSection(
  context: RouteContext<ChannelSettingRouteData>,
  inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (data.channel.channelType !== ChannelTypeGroup) {
    return undefined;
  }
  if (isGroupDisbanded(data.channelInfo)) {
    return undefined;
  }

  let name = data.subscriberOfMe?.remark;
  if (!name || name === "") {
    name = data.subscriberOfMe?.name;
  }

  return new Section({
    rows: [
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.channelSettings.myGroupNickname"),
          subTitle: name,
          onClick: () => {
            inputEditPush(
              context,
              name || "",
              (value: string) => {
                return updateChannelSettingMyGroupNickname({
                  channel: data.channel,
                  remark: value,
                });
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

export function buildChannelDangerSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  if (data.channel.channelType !== ChannelTypeGroup) {
    return undefined;
  }
  if (isGroupDisbanded(data.channelInfo)) {
    return undefined;
  }

  return new Section({
    rows: [
      new Row({
        cell: ListItemButton,
        properties: {
          title: t("base.module.channelSettings.clearMessages"),
          type: ListItemButtonType.warn,
          onClick: () => {
            WKApp.shared.baseContext.showAlert({
              content: t("base.module.channelSettings.clearMessagesConfirm"),
              onOk: async () => {
                await clearChannelSettingMessages({
                  channel: data.channel,
                });
              },
            });
          },
        },
      }),
      new Row({
        cell: ListItemButton,
        properties: {
          title: t("base.module.channelSettings.deleteAndExit"),
          type: ListItemButtonType.warn,
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
            WKApp.shared.baseContext.showAlert({
              content: t("base.module.channelSettings.deleteAndExitConfirm"),
              onOk: async () => {
                try {
                  await exitChannelSettingGroup({
                    channel: data.channel,
                    onDeleteConversationError: (err) => {
                      console.warn(
                        "[ChannelSetting] delete conversation after leaving failed:",
                        err
                      );
                    },
                  });
                } catch (err: any) {
                  Toast.error(
                    err?.msg ||
                      t("base.module.channelSettings.deleteAndExitFailed")
                  );
                  throw err;
                }
              },
            });
          },
        },
      }),
    ],
  });
}
