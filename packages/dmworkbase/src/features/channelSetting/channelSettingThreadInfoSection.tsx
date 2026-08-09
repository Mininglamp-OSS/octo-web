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
import { canRenameThread, ensureRenameMemberResolved } from "../../Service/threadPermission";
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
  // canRenameThread 判「登录用户是否父群活跃人类成员（非龙虾/非黑名单）」，创建者不享受
  // 短路、同样走成员记录 + isRenamableMember；不再收紧到创建者/群主/管理员。父群解散后与
  // ThreadPanel「更多菜单」isThreadMenuWritable 对齐一律隐藏（原先设置页解散后仍可改，
  // 形成一处可见一处不可见的撕裂）。
  const canEdit = !disbanded && canRenameThread(threadInfo?.groupNo);
  // 冷缓存兜底：超级群父群成员缓存可能从未写入/只有第一页，按需补齐当前用户自己的成员记录
  // （含创建者），解析命中后经订阅变更监听触发重渲染，让改名入口出现。
  if (threadInfo && !disbanded) {
    ensureRenameMemberResolved(threadInfo.groupNo);
  }
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
          // 放开后普通成员一般可改；走到这里多为龙虾/黑名单/非成员或父群已解散。
          // 给中性反馈，避免「可点击但无任何反应」的 dead click；服务端裁决的错误
          // 文案仍由 onSave 的 Toast.error 呈现。
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
