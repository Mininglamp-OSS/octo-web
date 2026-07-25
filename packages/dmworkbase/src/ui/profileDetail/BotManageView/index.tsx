import React, { useMemo, useRef, useState } from "react";
import type { ListItemSwitchContext } from "../../../Components/ListItem";
import "./index.css";

export interface BotManageViewLabels {
  mentionFree: string;
  mentionFreeHint: string;
  autoApprove: string;
  autoApproveHint: string;
  profileCommands: string;
  profileCommandsHint: string;
  comingSoon: string;
  loading: string;
  backendComingSoon: string;
  stayTuned: string;
  loadFailed: string;
  reload: string;
  searchPlaceholder: string;
  noSearchResult: string;
  empty: string;
  sectionEnabled: (count: number) => string;
  sectionOthers: string;
  rowOn: string;
  rowOff: string;
  rowBlocked: string;
}

export interface BotManageGroupItem {
  groupNo: string;
  name: string;
  noMention: boolean;
  allowNoMention?: boolean;
}

export interface BotManageViewProps {
  labels: BotManageViewLabels;
  onOpenMentionFree: () => void;
}

export interface MentionFreeListViewProps {
  labels: BotManageViewLabels;
  loading: boolean;
  backendMissing: boolean;
  loadError: boolean;
  searchKeyword: string;
  enabledGroups: BotManageGroupItem[];
  otherGroups: BotManageGroupItem[];
  loadingMore: boolean;
  onSearchKeywordChange: (value: string) => void;
  onReload: () => void;
  onLoadMore: () => void;
  onToggleMentionFree: (
    groupNo: string,
    next: boolean,
    ctx?: ListItemSwitchContext
  ) => void;
}

export default function BotManageView({
  labels,
  onOpenMentionFree,
}: BotManageViewProps) {
  return (
    <div className="wk-bot-manage-page">
      <div className="wk-bot-manage-menu">
        <BotManageMenuItem
          icon="@"
          title={labels.mentionFree}
          description={labels.mentionFreeHint}
          onClick={onOpenMentionFree}
        />
        <BotManageMenuItem
          icon="✓"
          title={labels.autoApprove}
          description={labels.autoApproveHint}
          status={labels.comingSoon}
          disabled
        />
        <BotManageMenuItem
          icon="i"
          title={labels.profileCommands}
          description={labels.profileCommandsHint}
          status={labels.comingSoon}
          disabled
        />
      </div>
    </div>
  );
}

function BotManageMenuItem({
  icon,
  title,
  description,
  status,
  disabled,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  status?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="wk-bot-manage-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="wk-bot-manage-menu-copy">
        <span className="wk-bot-manage-menu-title">{title}</span>
        <span className="wk-bot-manage-menu-desc">{description}</span>
      </span>
      <span className="wk-bot-manage-menu-right" aria-hidden="true">
        {disabled ? status : "›"}
      </span>
    </>
  );

  if (disabled) {
    return (
      <div className="wk-bot-manage-menu-row wk-bot-manage-menu-row-disabled">
        {content}
      </div>
    );
  }

  return (
    <button type="button" className="wk-bot-manage-menu-row" onClick={onClick}>
      {content}
    </button>
  );
}

export function MentionFreeListView({
  labels,
  loading,
  backendMissing,
  loadError,
  searchKeyword,
  enabledGroups,
  otherGroups,
  loadingMore,
  onSearchKeywordChange,
  onReload,
  onLoadMore,
  onToggleMentionFree,
}: MentionFreeListViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, clientHeight, scrollHeight } = el;
    if (scrollHeight - (scrollTop + clientHeight) < 48) {
      onLoadMore();
    }
  };

  if (loading) {
    return (
      <div className="wk-bot-manage-mention">
        <div className="wk-bot-manage-loading">{labels.loading}</div>
      </div>
    );
  }

  if (backendMissing) {
    return (
      <div className="wk-bot-manage-mention">
        <div className="wk-bot-manage-empty">
          {labels.backendComingSoon}
          <br />
          {labels.stayTuned}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="wk-bot-manage-mention">
        <div className="wk-bot-manage-error">
          {labels.loadFailed}
          <div className="wk-bot-manage-error-retry" onClick={onReload}>
            {labels.reload}
          </div>
        </div>
      </div>
    );
  }

  const isEmpty = enabledGroups.length === 0 && otherGroups.length === 0;

  return (
    <div className="wk-bot-manage-mention">
      <div className="wk-bot-manage-search">
        <input
          className="wk-bot-manage-search-input"
          type="text"
          placeholder={labels.searchPlaceholder}
          value={searchKeyword}
          onChange={(e) => onSearchKeywordChange(e.target.value)}
          data-testid="bot-manage-mention-search"
        />
      </div>
      <div
        className="wk-bot-manage-list"
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="bot-manage-mention-list"
      >
        {isEmpty && (
          <div className="wk-bot-manage-empty">
            {searchKeyword.trim() ? labels.noSearchResult : labels.empty}
          </div>
        )}

        {enabledGroups.length > 0 && (
          <>
            <div className="wk-bot-manage-section-title">
              {labels.sectionEnabled(enabledGroups.length)}
            </div>
            <div className="wk-bot-manage-group-list">
              {enabledGroups.map((group) => (
                <MentionFreeRow
                  key={group.groupNo}
                  group={group}
                  labels={labels}
                  onToggleMentionFree={onToggleMentionFree}
                />
              ))}
            </div>
          </>
        )}

        {otherGroups.length > 0 && (
          <>
            <div className="wk-bot-manage-section-title">
              {labels.sectionOthers}
            </div>
            <div className="wk-bot-manage-group-list">
              {otherGroups.map((group) => (
                <MentionFreeRow
                  key={group.groupNo}
                  group={group}
                  labels={labels}
                  onToggleMentionFree={onToggleMentionFree}
                />
              ))}
            </div>
          </>
        )}

        {loadingMore && (
          <div className="wk-bot-manage-loadmore">{labels.loading}</div>
        )}
      </div>
    </div>
  );
}

function MentionFreeRow({
  group,
  labels,
  onToggleMentionFree,
}: {
  group: BotManageGroupItem;
  labels: BotManageViewLabels;
  onToggleMentionFree: (
    groupNo: string,
    next: boolean,
    ctx?: ListItemSwitchContext
  ) => void;
}) {
  const [pending, setPending] = useState(false);
  const blocked = group.allowNoMention === false;
  const statusText = blocked
    ? labels.rowBlocked
    : group.noMention
    ? labels.rowOn
    : labels.rowOff;
  const ctx = useMemo<ListItemSwitchContext>(
    () => ({
      get loading() {
        return pending;
      },
      set loading(value: boolean) {
        setPending(value);
      },
    }),
    [pending]
  );

  return (
    <div className="wk-bot-manage-group-row">
      <div className="wk-bot-manage-group-main">
        <div className="wk-bot-manage-group-name">
          {group.name || group.groupNo}
        </div>
        <div className="wk-bot-manage-group-status">{statusText}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={group.noMention}
        aria-label={`${group.name || group.groupNo}: ${statusText}`}
        disabled={blocked || pending}
        className={`wk-bot-manage-switch ${
          group.noMention ? "wk-bot-manage-switch-on" : ""
        } ${pending ? "wk-bot-manage-switch-loading" : ""}`}
        onClick={() => {
          if (blocked || pending) return;
          onToggleMentionFree(group.groupNo, !group.noMention, ctx);
        }}
      >
        <span className="wk-bot-manage-switch-thumb" />
      </button>
    </div>
  );
}

export { BotManageView };
