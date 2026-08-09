import { Tag, Toast } from "@douyinfe/semi-ui";
import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row, Section } from "../../Service/Section";
import { parseThreadChannelId, ThreadStatus } from "../../Service/Thread";
import { canRenameThread } from "../../Service/threadPermission";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import { updateChannelSettingThreadName } from "../../bridge/channelSetting/channelSettingActions";
import {
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";
import { t } from "../../i18n";
import {
  ChannelSettingInfoRow,
  ChannelSettingInlineEditRow,
} from "../../ui/ChannelSettingRows";
import { ChannelSettingInputEditPush } from "./types";

export function buildThreadInfoSection(
  context: RouteContext<ChannelSettingRouteData>,
  _inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const { channel, channelInfo } = data;
  if (channel.channelType !== ChannelTypeCommunityTopic) return undefined;

  const threadInfo = parseThreadChannelId(channel.channelID);
  const disbanded =
    !!threadInfo &&
    isChannelDisbanded(new Channel(threadInfo.groupNo, ChannelTypeGroup));
  const thread = channelInfo?.orgData?.thread as any;
  const threadName = channelInfo?.title;
  // 服务端放开后（octo-server #542）任何父群活跃人类成员都可改子区名。
  // canRenameThread 只判「登录用户是否父群活跃成员（非龙虾）」，不再收紧到
  // 创建者/群主/管理员。与 ThreadPanel「更多菜单 → Edit name」同口径。
  const canEdit = canRenameThread(threadInfo?.groupNo);
  const statusTitle =
    thread?.status === ThreadStatus.Archived
      ? t("base.module.thread.status.archived")
      : thread?.status === ThreadStatus.Deleted
      ? t("base.module.thread.status.deleted")
      : t("base.module.thread.status.active");
  const statusColor =
    thread?.status === ThreadStatus.Archived
      ? "grey"
      : thread?.status === ThreadStatus.Deleted
      ? "red"
      : "green";
  const rows: Row[] = [
    new Row({
      cell: ChannelSettingInlineEditRow,
      properties: {
        title: t("base.module.thread.name"),
        value: threadName || "",
        placeholder: t("base.module.thread.name"),
        maxCount: THREAD_NAME_MAX_LENGTH,
        onStartEdit: () => {
          if (!threadInfo) return false;
          // 服务端放开后（octo-server #542）任何父群活跃人类成员都可改子区名，
          // 前端只挡龙虾/非成员（canRenameThread 粗过滤）；失败提示以服务端返回
          // 错误为准（下方 Toast.error），不做前置 Toast 拒绝。
          if (!canEdit) {
            return false;
          }
          return true;
        },
        onSave: async (value: string) => {
          if (!threadInfo) return;
          try {
            await updateChannelSettingThreadName({
              channel,
              groupNo: threadInfo.groupNo,
              shortId: threadInfo.shortId,
              name: value,
            });
            data.refresh();
          } catch (error: any) {
            Toast.error(error?.msg || t("base.module.thread.saveFailedRetry"));
            return false;
          }
        },
      },
    }),
  ];

  if (!disbanded) {
    rows.push(
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: t("base.module.thread.status.title"),
          value: (
            <Tag color={statusColor} size="small">
              {statusTitle}
            </Tag>
          ),
        },
      })
    );
  }

  if (threadInfo) {
    const parentChannel = new Channel(threadInfo.groupNo, ChannelTypeGroup);
    const parentInfo = getCurrentImChannelInfo(parentChannel);
    if (!parentInfo) void fetchCurrentImChannelInfo(parentChannel);
    rows.push(
      new Row({
        cell: ChannelSettingInfoRow,
        properties: {
          title: t("base.module.thread.parentGroup"),
          value: parentInfo?.title || threadInfo.groupNo,
          onClick: () => WKApp.endpoints.showConversation(parentChannel),
        },
      })
    );
  }

  return new Section({ title: t("base.module.thread.info"), rows });
}
