import React, { Component } from "react"
import { Button, Spin, Toast, Tooltip } from "@douyinfe/semi-ui"
import { Channel } from "wukongimjssdk"
import { UserPlus, LogOut, Trash2 } from "lucide-react"
import { Thread, ThreadStatus } from "../../Service/Thread"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import WKApp from "../../App"
import RouteContext from "../../Service/Context"
import { ThreadListVM, ThreadListState } from "./vm"
import { ThreadCreate } from "../ThreadCreate"
import { I18nContext, t } from "../../i18n"
import { wkConfirm } from "../WKModal"
import "./index.css"

export interface ThreadListProps {
  channel: Channel
  context: RouteContext<any>
}

export class ThreadList extends Component<ThreadListProps, ThreadListState> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  private vm: ThreadListVM

  constructor(props: ThreadListProps) {
    super(props)
    this.state = {
      loading: true,
      threads: [],
      error: null,
    }
    this.vm = new ThreadListVM(props.channel.channelID, (state) => {
      this.setState(state)
    })
  }

  componentDidMount() {
    this.vm.load()
  }

  handleThreadClick = (thread: Thread) => {
    const channel = new Channel(thread.channel_id, ChannelTypeCommunityTopic)
    WKApp.endpoints.showConversation(channel)
  }

  handleCreateThread = () => {
    const { channel, context } = this.props
    context.push(
      <ThreadCreate
        groupNo={channel.channelID}
        onSuccess={() => {
          context.pop()
          this.vm.load()
        }}
        onCancel={() => {
          context.pop()
        }}
      />,
      { title: "" }
    )
  }

  handleDelete = (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation()
    wkConfirm({
      title: t("base.threadPanel.delete"),
      content: t("base.threadList.deleteConfirm", { values: { name: thread.name } }),
      okType: "danger",
      onOk: async () => {
        try {
          await this.vm.delete(thread.short_id)
          Toast.success(t("base.threadList.deleted"))
        } catch (err: any) {
          Toast.error(err.message)
        }
      },
    })
  }

  handleJoin = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await this.vm.join(thread.short_id)
      Toast.success(t("base.threadList.joined"))
    } catch (err: any) {
      Toast.error(err.message)
    }
  }

  handleLeave = (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation()
    wkConfirm({
      title: t("base.module.thread.leave"),
      content: t("base.threadList.leaveConfirm", { values: { name: thread.name } }),
      onOk: async () => {
        try {
          await this.vm.leave(thread.short_id)
          Toast.success(t("base.threadList.left"))
        } catch (err: any) {
          Toast.error(err.message)
        }
      },
    })
  }

  formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days === 0) {
      return this.context.t("base.threadList.today")
    } else if (days === 1) {
      return this.context.t("base.threadList.yesterday")
    } else if (days < 7) {
      return this.context.t("base.threadList.daysAgo", { values: { count: days } })
    } else {
      return this.context.format.date(date)
    }
  }

  render() {
    const { loading, threads, error } = this.state

    if (loading) {
      return (
        <div className="wk-thread-list">
          <div className="wk-thread-list-loading">
            <Spin size="large" />
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="wk-thread-list">
          <div className="wk-thread-list-empty">
            <span className="wk-thread-list-empty-text">{error}</span>
            <Button onClick={() => this.vm.load()}>{t("base.threadList.retry")}</Button>
          </div>
        </div>
      )
    }

    const activeThreads = threads.filter((t) => t.status === ThreadStatus.Active)

    return (
      <div className="wk-thread-list">
        <div className="wk-thread-list-header">
          <span className="wk-thread-list-title">{t("base.threadList.title")}</span>
          <Button size="small" onClick={this.handleCreateThread}>
            {t("base.threadPanel.newThread")}
          </Button>
        </div>
        <div className="wk-thread-list-content">
          {activeThreads.length === 0 ? (
            <div className="wk-thread-list-empty">
              <span className="wk-thread-list-empty-text">{t("base.threadList.empty")}</span>
              <Button onClick={this.handleCreateThread}>{t("base.threadList.createFirst")}</Button>
            </div>
          ) : (
            activeThreads.map((thread) => (
              <div
                key={thread.short_id}
                className="wk-thread-item"
                onClick={() => this.handleThreadClick(thread)}
              >
                <div className="wk-thread-item-icon">#</div>
                <div className="wk-thread-item-content">
                  <div className="wk-thread-item-name">
                    <span className="wk-thread-item-name-text">{thread.name}</span>
                    {thread.is_member && (
                      <span className="wk-thread-item-badge">{t("base.threadList.joined")}</span>
                    )}
                  </div>
                  <div className="wk-thread-item-meta">
                    {thread.member_count !== undefined && thread.member_count > 0 && (
                      <span>{t("base.threadList.memberCount", { values: { count: thread.member_count } })}</span>
                    )}
                    {t("base.threadList.createdAt", { values: { time: this.formatTime(thread.created_at) } })}
                  </div>
                </div>
                <div className="wk-thread-item-actions">
                  {thread.is_member ? (
                    <Tooltip content={t("base.threadList.leave")}>
                      <Button
                        size="small"
                        type="tertiary"
                        icon={<LogOut size={14} />}
                        aria-label={t("base.module.thread.leave")}
                        onClick={(e) => this.handleLeave(thread, e)}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip content={t("base.threadList.join")}>
                      <Button
                        size="small"
                        type="primary"
                        icon={<UserPlus size={14} />}
                        aria-label={t("base.threadList.joinThread")}
                        onClick={(e) => this.handleJoin(thread, e)}
                      />
                    </Tooltip>
                  )}
                  {thread.creator_uid === WKApp.loginInfo.uid && (
                    <Tooltip content={t("base.threadPanel.delete")}>
                      <Button
                        size="small"
                        type="danger"
                        icon={<Trash2 size={14} />}
                        aria-label={t("base.threadPanel.delete")}
                        className="wk-thread-item-action-btn"
                        onClick={(e) => this.handleDelete(thread, e)}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }
}

export default ThreadList
