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
  // 改名走「服务端为唯一权威」（WS-23）：前端不再用父群订阅缓存前置判定谁能改子区名
  // （客户端只持有部分 roster，超级群父群仅缓存首页，任何本地 gate 都会误判合法成员）。
  // 唯一保留的是纯 UI 状态：父群解散后不可改，与 ThreadPanel「更多菜单」isThreadMenuWritable
  // 对齐（两处一致）；其余交由服务端裁决，错误经下方 onSave 的 Toast.error 呈现。
  const canEdit = !disbanded;
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
          // 唯一的前端拦截是父群已解散（纯 UI 状态，与 ThreadPanel 一致）——给一句诚实的
          // 「现在无法改名」，不承诺稍后重试。其余成员一律放行，交服务端裁决 + onSave 的 Toast.error。
          if (!canEdit) {
            Toast.info(t("base.module.channelSettings.renameUnavailable"));
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
