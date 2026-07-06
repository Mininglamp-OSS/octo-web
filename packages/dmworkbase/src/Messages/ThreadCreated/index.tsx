import { MessageContent, Channel, ChannelTypePerson } from "wukongimjssdk"
import React from "react"
import { Toast } from "@douyinfe/semi-ui"
import { MessageCell } from "../MessageCell"
import WKApp from "../../App"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import WKAvatar from "../../Components/WKAvatar"
import { getTimeStringAutoShort2 } from "../../Utils/time"
import { parseThreadChannelId } from "../../Service/Thread"
import MessageRow from "../../ui/message/MessageRow"
import { I18nContext, t } from "../../i18n"
import "./index.css"

interface LastMessage {
  from_uid: string
  from_name: string
  content: string
  timestamp: number
}

interface Participant {
  uid: string
  name: string
}

export class ThreadCreatedContent extends MessageContent {
  content!: string
  from_uid!: string
  from_name!: string
  short_id!: string
  channel_id!: string
  channel_type!: number
  thread_name!: string
  message_count?: number
  last_message?: LastMessage
  participants?: Participant[]

  decodeJSON(contentObj: any) {
    this.content = contentObj["content"] || ""
    this.from_uid = contentObj["from_uid"] || ""
    this.from_name = contentObj["from_name"] || ""
    this.short_id = contentObj["short_id"] || ""
    this.channel_id = contentObj["channel_id"] || ""
    this.channel_type = contentObj["channel_type"] || ChannelTypeCommunityTopic
    this.thread_name = contentObj["thread_name"] || ""
    this.message_count = contentObj["message_count"]
    if (contentObj["last_message"]) {
      this.last_message = {
        from_uid: contentObj["last_message"]["from_uid"] || "",
        from_name: contentObj["last_message"]["from_name"] || "",
        content: contentObj["last_message"]["content"] || "",
        timestamp: contentObj["last_message"]["timestamp"] || 0,
      }
    }
    if (contentObj["participants"] && Array.isArray(contentObj["participants"])) {
      this.participants = contentObj["participants"].map((p: any) => ({
        uid: p.uid || "",
        name: p.name || "",
      }))
    }
  }

  get conversationDigest() {
    return t("base.threadCreated.digest", { values: { name: this.thread_name } })
  }
}

export class ThreadCreatedCell extends MessageCell {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  handleClick = async () => {
    const { message, context } = this.props
    const content = message.content as ThreadCreatedContent
    const threadInfo = parseThreadChannelId(content.channel_id)

    if (threadInfo) {
      try {
        // 先检查子区是否存在
        const resp = await WKApp.apiClient.get(
          `groups/${threadInfo.groupNo}/threads/${threadInfo.shortId}`
        )
        // status: 1=活跃, 2=归档, 3=删除
        if (resp.status === 3) {
          Toast.warning(this.context.t("base.threadCreated.deleted"))
          return
        }
        // 归档状态允许进入查看；是否自动恢复活跃由后端发送链路处理。
      } catch (err: any) {
        Toast.warning(this.context.t("base.threadCreated.deletedOrMissing"))
        return
      }
    }

    // 优先在右侧面板打开，如果不支持则跳转到独立会话
    if (context?.openThreadPanel) {
      context.openThreadPanel(content.channel_id, content.thread_name)
    } else {
      const channel = new Channel(content.channel_id, content.channel_type)
      WKApp.endpoints.showConversation(channel)
    }
  }

  render() {
    const { message, context } = this.props
    const content = message.content as ThreadCreatedContent
    const messageCount = content.message_count || 0
    const timeStr = content.last_message
      ? getTimeStringAutoShort2(content.last_message.timestamp * 1000, true)
      : getTimeStringAutoShort2(message.timestamp * 1000, true)

    // 参与者列表：优先使用 participants，回退到 last_message 发送者
    let participantUids: string[] = []
    if (content.participants && content.participants.length > 0) {
      participantUids = content.participants.slice(0, 3).map(p => p.uid)
    } else if (content.last_message?.from_uid) {
      participantUids = [content.last_message.from_uid]
    }

    // 手动构造 MessageRow props (使用 Thread 创建者信息)
    const rowProps = {
      isSend: message.send,
      isContinue: false, // Thread 消息总是显示完整header
      isSelected: false,
      showAvatar: true,
      avatarUrl: WKApp.shared.avatarUser(content.from_uid || message.fromUID),
      senderName: content.from_name || this.context.t("base.threadCreated.user"),
      timestamp: getTimeStringAutoShort2(message.timestamp * 1000, true),
      isOnline: false,
    }

    return (
      <MessageRow 
        {...rowProps}
        selectionMode={context.editOn()}
        onContextMenu={(event) => context.showContextMenus(message, event)}
        isActive={context.isContextMenuOpen(message.message)}
        onAvatarClick={(e) => context.onTapAvatar(content.from_uid || message.fromUID, e)}
        onSenderNameClick={() => context.showUser(content.from_uid || message.fromUID)}
      >
        <div className="wk-thread-created-card" onClick={this.handleClick}>
        {/* 消息正文预览 */}
        <div className="wk-thread-created-preview">
          {content.content || this.context.t("base.threadCreated.created")}
        </div>

        {/* 底部元数据行 */}
        <div className="wk-thread-created-meta">
          {/* Thread 链接 */}
          <span className="wk-thread-created-link">
            🧵{content.thread_name}·{this.context.t("base.threadCreated.replyCount", { values: { count: messageCount } })}
          </span>

          {/* 参与者头像组 */}
          {participantUids.length > 0 && (
            <div className="wk-thread-created-avatars">
              {participantUids.map((uid, idx) => (
                <WKAvatar
                  key={uid}
                  channel={new Channel(uid, ChannelTypePerson)}
                  style={{
                    width: 16,
                    height: 16,
                    fontSize: 8,
                    borderRadius: '50%',
                    marginLeft: idx > 0 ? -8 : 0,
                    border: '1.5px solid rgba(255,255,255,1)',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      </MessageRow>
    )
  }
}
