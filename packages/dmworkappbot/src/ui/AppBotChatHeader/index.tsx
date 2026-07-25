import React from "react"
import "./index.css"

export interface AppBotChatHeaderProps {
  avatar: React.ReactNode
  displayName: string
}

const AppBotChatHeader: React.FC<AppBotChatHeaderProps> = ({
  avatar,
  displayName,
}) => {
  return (
    <div className="appbot-chat-header">
      <div className="appbot-chat-header-avatar">{avatar}</div>
      <div className="appbot-chat-header-name">{displayName}</div>
    </div>
  )
}

export default AppBotChatHeader
export { AppBotChatHeader }
