import React from "react"
import type { AppBotLoadState, AppBotViewItem } from "../../bridge/types"
import "./index.css"

export interface AppBotListSection {
  key: string
  title: string
  bots: AppBotViewItem[]
}

export interface AppBotListViewProps {
  title: string
  searchPlaceholder: string
  keyword: string
  state: AppBotLoadState
  sections: AppBotListSection[]
  selectedUid?: string | null
  loadingText: string
  loadFailedText: string
  retryLabel: string
  emptyText: string
  noMatchesText: string
  defaultDescription: string
  onKeywordChange: (keyword: string) => void
  onRetry: () => void
  onSelect: (bot: AppBotViewItem) => void
  renderAvatar: (bot: AppBotViewItem) => React.ReactNode
}

const AppBotListView: React.FC<AppBotListViewProps> = ({
  title,
  searchPlaceholder,
  keyword,
  state,
  sections,
  selectedUid,
  loadingText,
  loadFailedText,
  retryLabel,
  emptyText,
  noMatchesText,
  defaultDescription,
  onKeywordChange,
  onRetry,
  onSelect,
  renderAvatar,
}) => {
  const hasBots = sections.some((section) => section.bots.length > 0)

  const renderStatus = () => {
    if (state === "loading") {
      return (
        <div className="appbot-list-status">
          <div className="appbot-spinner" />
          <span>{loadingText}</span>
        </div>
      )
    }

    if (state === "error") {
      return (
        <div className="appbot-list-status">
          <span>{loadFailedText}</span>
          <button className="appbot-retry-btn" onClick={onRetry}>{retryLabel}</button>
        </div>
      )
    }

    if (!hasBots) {
      return (
        <div className="appbot-list-status">
          <span>{keyword ? noMatchesText : emptyText}</span>
        </div>
      )
    }

    return null
  }

  const renderItem = (bot: AppBotViewItem) => {
    const isActive = selectedUid === bot.uid
    return (
      <button
        key={bot.id}
        type="button"
        className={`appbot-list-item ${isActive ? "appbot-list-item-active" : ""}`}
        onClick={() => onSelect(bot)}
      >
        <div className="appbot-list-avatar">{renderAvatar(bot)}</div>
        <div className="appbot-list-info">
          <div className="appbot-list-name">{bot.displayName}</div>
          <div className="appbot-list-desc">{bot.description || defaultDescription}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="appbot-list-view">
      <div className="appbot-page-header">
        <div className="appbot-page-title">{title}</div>
        <input
          type="search"
          className="appbot-search-input"
          placeholder={searchPlaceholder}
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
        />
      </div>
      <div className="appbot-page-list">
        {renderStatus()}
        {state === "ready" && hasBots && sections.map((section) => {
          if (section.bots.length === 0) return null
          return (
            <div className="appbot-list-section" key={section.key}>
              <div className="appbot-list-section-title">{section.title}</div>
              {section.bots.map(renderItem)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AppBotListView
export { AppBotListView }
