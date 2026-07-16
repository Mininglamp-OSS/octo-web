import React from "react";
import { Hash, MessageCircleMore } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import "./index.css";

export interface GlobalChatConversationSummary {
  key: string;
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  countLabel: string;
  isThread?: boolean;
}

export interface GlobalChatSearchLayoutLabels {
  filterTitle: string;
  startHint: string;
  emptyHint: string;
  errorHint: string;
  truncatedHint: string;
}

export interface GlobalChatSearchLayoutState {
  status: "idle" | "loading" | "ready" | "error";
  isTruncated?: boolean;
}

export interface GlobalChatSearchLayoutResult {
  countLabel?: string;
  content: React.ReactNode;
}

export interface GlobalChatSearchLayoutProps {
  conversations: GlobalChatConversationSummary[];
  selectedKey?: string;
  labels: GlobalChatSearchLayoutLabels;
  state: GlobalChatSearchLayoutState;
  result: GlobalChatSearchLayoutResult;
  filterContent?: React.ReactNode;
  onSelectConversation: (key: string) => void;
}

function ConversationAvatar({
  conversation,
}: {
  conversation: GlobalChatConversationSummary;
}) {
  if (conversation.avatarUrl) {
    return (
      <img
        className="wk-global-chat-search-layout__avatar"
        src={conversation.avatarUrl}
        alt=""
      />
    );
  }
  return (
    <span className="wk-global-chat-search-layout__avatar-placeholder">
      {conversation.isThread ? (
        <Hash size={18} />
      ) : (
        <MessageCircleMore size={18} />
      )}
    </span>
  );
}

export function GlobalChatSearchLayout({
  conversations,
  selectedKey,
  labels,
  state,
  result,
  filterContent,
  onSelectConversation,
}: GlobalChatSearchLayoutProps) {
  const showConversationEmpty =
    state.status === "ready" && conversations.length === 0;

  return (
    <div
      className={`wk-global-chat-search-layout${
        filterContent ? " has-filters" : ""
      }`}
    >
      <aside className="wk-global-chat-search-layout__conversations">
        <div className="wk-global-chat-search-layout__conversation-list">
          {state.status === "loading" && (
            <div className="wk-global-chat-search-layout__pane-state">
              <span className="wk-global-chat-search-layout__spinner" />
            </div>
          )}
          {state.status === "idle" && (
            <div className="wk-global-chat-search-layout__pane-state">
              {labels.startHint}
            </div>
          )}
          {state.status === "error" && (
            <div className="wk-global-chat-search-layout__pane-state is-error">
              {labels.errorHint}
            </div>
          )}
          {showConversationEmpty && (
            <div className="wk-global-chat-search-layout__pane-state">
              {labels.emptyHint}
            </div>
          )}
          {conversations.map((conversation) => {
            const isSelected = conversation.key === selectedKey;
            return (
              <button
                type="button"
                key={conversation.key}
                className={`wk-global-chat-search-layout__conversation${
                  isSelected ? " is-selected" : ""
                }${conversation.isThread ? " is-thread" : ""}`}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelectConversation(conversation.key)}
              >
                <ConversationAvatar conversation={conversation} />
                <span className="wk-global-chat-search-layout__conversation-copy">
                  {conversation.isThread && conversation.subtitle && (
                    <span className="wk-global-chat-search-layout__conversation-breadcrumb">
                      {conversation.subtitle}
                    </span>
                  )}
                  <span className="wk-global-chat-search-layout__conversation-first-line">
                    <span className="wk-global-chat-search-layout__conversation-name">
                      {conversation.isThread && (
                        <ThreadIcon
                          size={13}
                          className="wk-global-chat-search-layout__thread-icon"
                        />
                      )}
                      {conversation.name}
                    </span>
                  </span>
                  <span className="wk-global-chat-search-layout__conversation-second-line">
                    <span className="wk-global-chat-search-layout__conversation-subtitle">
                      {conversation.countLabel}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {state.isTruncated && (
          <div className="wk-global-chat-search-layout__truncated">
            {labels.truncatedHint}
          </div>
        )}
      </aside>

      <main className="wk-global-chat-search-layout__results">
        {result.countLabel && (
          <header className="wk-global-chat-search-layout__result-header">
            <div className="wk-global-chat-search-layout__result-title">
              {result.countLabel}
            </div>
          </header>
        )}
        <div className="wk-global-chat-search-layout__result-content">
          {result.content}
        </div>
      </main>

      {filterContent && (
        <aside className="wk-global-chat-search-layout__filters">
          <div className="wk-global-chat-search-layout__filter-content">
            {filterContent}
          </div>
        </aside>
      )}
    </div>
  );
}

export default GlobalChatSearchLayout;
