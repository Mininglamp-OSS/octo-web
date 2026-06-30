import WKApp from "../App"
import FollowService from "../Service/FollowService"
import SidebarService, { SidebarTargetType } from "../Service/SidebarService"
import { Thread } from "../Service/Thread"

/**
 * 手建子区后，若父群已关注则自动关注新子区（best-effort）。
 *
 * 后端 `auto_follow_threads` fanout 只对 bot 创建的子区生效且是最终一致，
 * 前端手建入口不能依赖它（GH#292）。这里在 threadCreate 成功后补一次关注：
 * 仅当父群已关注（权威源是 sidebar follow 快照，而非 channelInfo.orgData.is_followed）
 * 才关注新子区，语义对齐 issue 期望。
 *
 * 失败不抛出、不阻塞创建反馈。
 */
export async function maybeFollowNewThread(
  groupNo: string,
  thread: Thread
): Promise<void> {
  try {
    const resp = await SidebarService.sync({
      tab: "follow",
      device_uuid: WKApp.shared.deviceId,
    })
    const parentFollowed = (resp.items ?? []).some(
      (it) => it.target_type === SidebarTargetType.CHANNEL && it.target_id === groupNo
    )
    if (parentFollowed) {
      await FollowService.followThread({ thread_channel_id: thread.channel_id })
      // 让 follow 侧栏刷新，新子区即时进关注 tab
      WKApp.mittBus.emit("sidebar-reload" as any)
    }
  } catch (err) {
    console.warn("[maybeFollowNewThread] auto-follow new thread failed", err)
  }
}
