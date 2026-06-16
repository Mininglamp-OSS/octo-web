import { Thread, ThreadStatus, buildThreadChannelId } from "../../Service/Thread"
import { syncThreadArchiveState } from "../../Service/threadArchiveSync"
import WKApp from "../../App"
import { t } from "../../i18n"

export interface ThreadListState {
  loading: boolean
  threads: Thread[]
  error: string | null
}

export class ThreadListVM {
  private groupNo: string
  private onStateChange: (state: ThreadListState) => void

  private state: ThreadListState = {
    loading: true,
    threads: [],
    error: null,
  }

  constructor(groupNo: string, onStateChange: (state: ThreadListState) => void) {
    this.groupNo = groupNo
    this.onStateChange = onStateChange
  }

  getState(): ThreadListState {
    return this.state
  }

  private setState(newState: Partial<ThreadListState>) {
    this.state = { ...this.state, ...newState }
    this.onStateChange(this.state)
  }

  async load() {
    this.setState({ loading: true, error: null })
    try {
      const threads = await WKApp.dataSource.channelDataSource.threadList(this.groupNo, {
        page_index: 1,
        page_size: 100
      })
      this.setState({ loading: false, threads })
    } catch (err: any) {
      this.setState({ loading: false, error: err?.msg || t("base.threadList.loadFailed") })
    }
  }

  // 第四个归档入口（issue #345）。当前未接 UI：ThreadList 组件只渲染活跃子区、
  // 没有归档按钮调用本方法，属死代码。仍与另外三个入口（ThreadPanel 行内 / 详情菜单、
  // ChannelSetting thread.actions）一样收口到 syncThreadArchiveState，以权威 Archived
  // 状态写回 channelInfo 缓存并 emit("sidebar-reload")，避免将来接 UI 时再次漏掉左侧
  // sidebar 同步。
  async archive(shortId: string) {
    try {
      await WKApp.dataSource.channelDataSource.threadArchive(this.groupNo, shortId)
      syncThreadArchiveState(
        buildThreadChannelId(this.groupNo, shortId),
        ThreadStatus.Archived
      )
      await this.load()
    } catch (err: any) {
      throw new Error(err?.msg || t("base.module.thread.archiveFailedRetry"))
    }
  }

  async delete(shortId: string) {
    try {
      await WKApp.dataSource.channelDataSource.threadDelete(this.groupNo, shortId)
      await this.load()
    } catch (err: any) {
      throw new Error(err?.msg || t("base.threadPanel.deleteFailedRetry"))
    }
  }

  async join(shortId: string) {
    try {
      await WKApp.dataSource.channelDataSource.threadJoin(shortId)
      await this.load()
    } catch (err: any) {
      throw new Error(err?.msg || t("base.threadList.joinFailed"))
    }
  }

  async leave(shortId: string) {
    try {
      await WKApp.dataSource.channelDataSource.threadLeave(shortId)
      await this.load()
    } catch (err: any) {
      throw new Error(err?.msg || t("base.threadList.leaveFailed"))
    }
  }
}
