import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

import WKApp from "../../App";
import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { wkConfirm } from "../../Components/WKModal";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import RouteContext from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { parseThreadChannelId, ThreadStatus } from "../../Service/Thread";
import { runChannelSettingThreadArchive } from "../../Service/threadArchiveAction";
import { shouldShowThreadArchiveAction } from "../../Service/threadPermission";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import { leaveChannelSettingThread } from "../../bridge/channelSetting/channelSettingActions";
import { t } from "../../i18n";
import { ChannelSettingActionRow } from "../../ui/ChannelSettingRows";

export function buildThreadActionsSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const { channel } = data;
  if (channel.channelType !== ChannelTypeCommunityTopic) return undefined;
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
  const rows: Row[] = [];

  if (threadInfo && showArchiveAction) {
    rows.push(
      new Row({
        cell: ChannelSettingActionRow,
        properties: {
          title: isArchived
            ? t("base.module.thread.unarchive")
            : t("base.module.thread.archive"),
          onClick: () => {
            const name =
              thread?.name ||
              data.channelInfo?.title ||
              t("base.module.thread.fallbackName");
            wkConfirm({
              title: isArchived
                ? t("base.module.thread.unarchiveConfirmTitle", {
                    values: { name },
                  })
                : t("base.module.thread.archiveConfirmTitle", {
                    values: { name },
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
                } catch (error: any) {
                  Toast.error(
                    error?.msg ||
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
      cell: ChannelSettingActionRow,
      properties: {
        title: t("base.module.thread.leave"),
        danger: true,
        onClick: () => {
          WKApp.shared.baseContext.showAlert({
            content: t("base.module.thread.leaveConfirm"),
            onOk: async () => {
              if (!threadInfo) return;
              try {
                await leaveChannelSettingThread({
                  channel,
                  shortId: threadInfo.shortId,
                  onDeleteConversationError: (error) => {
                    console.warn(
                      "[ChannelSetting] delete thread conversation after leaving failed:",
                      error
                    );
                  },
                });
              } catch (error: any) {
                Toast.error(error?.msg || t("base.module.thread.leaveFailed"));
                throw error;
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
