import { Channel } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import WKApp from "../App";
import { ChannelTypeCommunityTopic } from "./Const";
import { ThreadStatus } from "./Thread";
import { syncThreadArchiveState } from "./threadArchiveSync";
import { t } from "../i18n";

/**
 * ChannelSetting「thread.actions」归档 / 取消归档入口（issue #345，入口 3）的成功流程。
 *
 * 抽成独立函数有两个目的：
 *   1. module.tsx 的 onOk 是内联闭包，整文件依赖图过重（lottie/tiptap/howler 等）无法
 *      在单测里直接 import 驱动；抽出来后可对「成功分支调用 syncThreadArchiveState 并
 *      emit('sidebar-reload')」做回归测试。
 *   2. 与 ThreadPanel 各入口保持同一套副作用顺序：先打归档/取消归档接口，成功后
 *      Toast 提示，再用操作后的【权威 status】走 syncThreadArchiveState 同步左侧
 *      sidebar（直接写回 channelInfo 缓存，避免被在途旧 fetch 覆盖，见 B1 去重竞态）。
 *
 * 失败时向上抛出，由调用方 catch 弹错误提示（保留各入口自己的文案）。
 *
 * @param isArchived 操作【前】子区是否已归档。true → 执行取消归档（权威状态变 Active）；
 *                   false → 执行归档（权威状态变 Archived）。
 */
export async function runChannelSettingThreadArchive(params: {
  channel: Channel;
  groupNo: string;
  shortId: string;
  isArchived: boolean;
}): Promise<void> {
  const { channel, groupNo, shortId, isArchived } = params;

  if (isArchived) {
    await WKApp.dataSource.channelDataSource.threadUnarchive(groupNo, shortId);
  } else {
    await WKApp.dataSource.channelDataSource.threadArchive(groupNo, shortId);
  }

  Toast.success(
    isArchived
      ? t("base.module.thread.unarchiveSuccess")
      : t("base.module.thread.archiveSuccess")
  );

  // 权威状态与操作前相反：原已归档 → Active；原活跃 → Archived。
  const threadChannel =
    channel.channelType === ChannelTypeCommunityTopic
      ? channel
      : new Channel(channel.channelID, ChannelTypeCommunityTopic);
  syncThreadArchiveState(
    threadChannel,
    isArchived ? ThreadStatus.Active : ThreadStatus.Archived
  );
}
