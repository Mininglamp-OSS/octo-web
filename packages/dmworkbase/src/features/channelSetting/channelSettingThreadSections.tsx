import { Toast, Tag } from "@douyinfe/semi-ui";
import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import ChannelWebhookPanel from "../../Components/ChannelWebhook";
import { GroupMdEditor } from "../../Components/GroupMdEditor";
import {
  ListItem,
  ListItemButton,
  ListItemButtonType,
} from "../../Components/ListItem";
import { wkConfirm } from "../../Components/WKModal";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import { Row, Section } from "../../Service/Section";
import { parseThreadChannelId, ThreadStatus } from "../../Service/Thread";
import { runChannelSettingThreadArchive } from "../../Service/threadArchiveAction";
import {
  canRenameThread,
  isParentGroupManager,
  shouldShowThreadArchiveAction,
} from "../../Service/threadPermission";
import {
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../im-runtime/currentChannelRuntime";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import { I18nText, t } from "../../i18n";
import {
  leaveChannelSettingThread,
  updateChannelSettingThreadName,
} from "../../bridge/channelSetting/channelSettingActions";
import { ChannelSettingInputEditPush } from "./channelSettingSections";

export function buildThreadInfoSection(
  context: RouteContext<ChannelSettingRouteData>,
  inputEditPush: ChannelSettingInputEditPush
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;
  if (channel.channelType !== ChannelTypeCommunityTopic) {
    return undefined;
  }

  const threadInfo = parseThreadChannelId(channel.channelID);
  const disbanded =
    !!threadInfo &&
    isChannelDisbanded(new Channel(threadInfo.groupNo, ChannelTypeGroup));

  const channelInfo = data.channelInfo;
  const threadName = channelInfo?.title;
  const thread = channelInfo?.orgData?.thread as any;
  const canEdit = canRenameThread(thread, threadInfo?.groupNo);
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

  const rows = new Array<Row>();
  rows.push(
    new Row({
      cell: ListItem,
      properties: {
        title: t("base.module.thread.name"),
        subTitle: threadName,
        onClick: () => {
          if (!threadInfo) return;
          if (!canEdit) {
            Toast.warning(t("base.module.thread.nameOnlyCreatorOrManager"));
            return;
          }
          inputEditPush(
            context,
            threadName || "",
            async (value: string) => {
              try {
                await updateChannelSettingThreadName({
                  channel,
                  groupNo: threadInfo.groupNo,
                  shortId: threadInfo.shortId,
                  name: value,
                });
              } catch (err: any) {
                Toast.error(err?.msg || t("base.module.thread.saveFailedRetry"));
                return;
              }
              data.refresh();
            },
            t("base.module.thread.name"),
            THREAD_NAME_MAX_LENGTH
          );
        },
      },
    })
  );

  if (!disbanded) {
    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.thread.status.title"),
          subTitle: (
            <Tag color={statusColor} size="small">
              {statusTitle}
            </Tag>
          ),
        },
      })
    );
  }

  if (threadInfo) {
    const groupChannel = new Channel(threadInfo.groupNo, ChannelTypeGroup);
    const groupInfo = getCurrentImChannelInfo(groupChannel);
    if (!groupInfo) {
      void fetchCurrentImChannelInfo(groupChannel);
    }
    const groupName = groupInfo?.title || threadInfo.groupNo;
    rows.push(
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.module.thread.parentGroup"),
          subTitle: groupName,
          onClick: () => {
            WKApp.endpoints.showConversation(groupChannel);
          },
        },
      })
    );
  }

  return new Section({
    title: t("base.module.thread.info"),
    rows,
  });
}

export function buildThreadMdSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;
  const channelInfo = data.channelInfo;
  if (channel.channelType !== ChannelTypeCommunityTopic) {
    return undefined;
  }
  const threadInfo = parseThreadChannelId(channel.channelID);
  if (!threadInfo) {
    return undefined;
  }
  if (isChannelDisbanded(new Channel(threadInfo.groupNo, ChannelTypeGroup))) {
    return undefined;
  }

  const hasThreadMd = channelInfo?.orgData?.has_thread_md;
  const mdVersion = channelInfo?.orgData?.thread_md_version || 0;

  return new Section({
    rows: [
      new Row({
        cell: ListItem,
        properties: {
          title: "GROUP.md",
          subTitle: hasThreadMd
            ? t("base.module.channelSettings.configuredVersion", {
                values: { version: mdVersion },
              })
            : t("base.module.channelSettings.notConfigured"),
          onClick: () => {
            const latestData = context.routeData() as ChannelSettingRouteData;
            const subscriberOfMe = latestData?.subscriberOfMe;
            const latestChannelInfo = latestData?.channelInfo;

            const backendCanEdit =
              !!latestChannelInfo?.orgData?.thread?.can_edit_thread_md;
            const isGroupOwnerOrManager =
              subscriberOfMe &&
              (subscriberOfMe.role === 1 || subscriberOfMe.role === 2);
            const isThreadCreator =
              latestChannelInfo?.orgData?.thread?.creator_uid ===
              WKApp.loginInfo.uid;
            const canEditMd = !!(
              backendCanEdit ||
              isThreadCreator ||
              isGroupOwnerOrManager
            );

            context.push(
              <GroupMdEditor channel={channel} canEdit={canEditMd} />,
              new RouteContextConfig({
                title: "GROUP.md",
              })
            );
          },
        },
      }),
    ],
  });
}

export function buildThreadWebhookSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;
  if (channel.channelType !== ChannelTypeCommunityTopic) {
    return undefined;
  }
  const threadInfo = parseThreadChannelId(channel.channelID);
  if (!threadInfo) {
    return undefined;
  }
  const thread = data.channelInfo?.orgData?.thread as any;
  if (thread?.status !== ThreadStatus.Active) {
    return undefined;
  }
  const parentGroupChannel = new Channel(threadInfo.groupNo, ChannelTypeGroup);
  if (isChannelDisbanded(parentGroupChannel)) {
    return undefined;
  }

  return new Section({
    rows: [
      new Row({
        cell: ListItem,
        properties: {
          title: t("base.threadPanel.webhook"),
          onClick: () => {
            context.push(
              <ChannelWebhookPanel
                channel={parentGroupChannel}
                isManager={isParentGroupManager(threadInfo.groupNo)}
                threadShortId={threadInfo.shortId}
              />,
              new RouteContextConfig({
                title: <I18nText k="base.threadPanel.webhook" />,
              })
            );
          },
        },
      }),
    ],
  });
}

export function buildThreadActionsSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;
  if (channel.channelType !== ChannelTypeCommunityTopic) {
    return undefined;
  }
  const threadInfo = parseThreadChannelId(channel.channelID);
  if (
    threadInfo &&
    isChannelDisbanded(new Channel(threadInfo.groupNo, ChannelTypeGroup))
  ) {
    return undefined;
  }

  const thread = data.channelInfo?.orgData?.thread as any;
  const showArchiveAction = shouldShowThreadArchiveAction({
    thread,
    groupNo: threadInfo?.groupNo,
    isManagerOrCreatorOfMeFallback: data.isManagerOrCreatorOfMe,
  });
  const isArchived = thread?.status === ThreadStatus.Archived;
  const rows = new Array<Row>();

  if (threadInfo && showArchiveAction) {
    rows.push(
      new Row({
        cell: ListItemButton,
        properties: {
          title: isArchived
            ? t("base.module.thread.unarchive")
            : t("base.module.thread.archive"),
          type: ListItemButtonType.default,
          onClick: () => {
            const threadDisplayName =
              thread?.name ||
              data.channelInfo?.title ||
              t("base.module.thread.fallbackName");
            wkConfirm({
              title: isArchived
                ? t("base.module.thread.unarchiveConfirmTitle", {
                    values: { name: threadDisplayName },
                  })
                : t("base.module.thread.archiveConfirmTitle", {
                    values: { name: threadDisplayName },
                  }),
              okText: isArchived
                ? t("base.module.thread.unarchive")
                : t("base.module.thread.archiveOk"),
              cancelText: t("base.common.cancel"),
              content: isArchived
                ? t("base.module.thread.unarchiveConfirmContent")
                : t("base.module.thread.archiveConfirmContent"),
              onOk: async () => {
                try {
                  await runChannelSettingThreadArchive({
                    channel,
                    groupNo: threadInfo.groupNo,
                    shortId: threadInfo.shortId,
                    isArchived,
                  });
                  data.refresh();
                } catch (err: any) {
                  Toast.error(
                    err?.msg ||
                      (isArchived
                        ? t("base.module.thread.unarchiveFailedRetry")
                        : t("base.module.thread.archiveFailedRetry"))
                  );
                }
              },
            });
          },
        },
      })
    );
  }

  rows.push(
    new Row({
      cell: ListItemButton,
      properties: {
        title: t("base.module.thread.leave"),
        type: ListItemButtonType.warn,
        onClick: () => {
          WKApp.shared.baseContext.showAlert({
            content: t("base.module.thread.leaveConfirm"),
            onOk: async () => {
              if (threadInfo) {
                try {
                  await leaveChannelSettingThread({
                    channel: data.channel,
                    shortId: threadInfo.shortId,
                    onDeleteConversationError: (err) => {
                      console.warn(
                        "[ChannelSetting] delete thread conversation after leaving failed:",
                        err
                      );
                    },
                  });
                } catch (err: any) {
                  Toast.error(err?.msg || t("base.module.thread.leaveFailed"));
                  throw err;
                }
              }
            },
          });
        },
      },
    })
  );

  return new Section({
    title: t("base.module.thread.management"),
    rows,
  });
}
