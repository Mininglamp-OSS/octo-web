import React, { useRef } from "react";
import {
  ListItem,
  ListItemSwitch,
  type ListItemSwitchContext,
} from "../../../Components/ListItem";
import "./index.css";

export interface BotManageViewLabels {
  mentionFree: string;
  autoApprove: string;
  profileCommands: string;
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
}

export interface BotManageGroupItem {
  groupNo: string;
  name: string;
  noMention: boolean;
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
    ctx?: ListItemSwitchContext,
  ) => void;
}

export default function BotManageView({
  labels,
  onOpenMentionFree,
}: BotManageViewProps) {
  const chevron = <span className="wk-list-chevron">›</span>;
  return (
    <div className="wk-bot-manage-page">
      <div className="wk-bot-manage-menu">
        <ListItem
          style={{}}
          title={labels.mentionFree}
          subTitle={chevron}
          onClick={onOpenMentionFree}
        />
        <div className="wk-bot-manage-menu-item-disabled">
          <ListItem
            style={{}}
            title={labels.autoApprove}
            subTitle={
              <span className="wk-list-chevron">{labels.comingSoon}</span>
            }
          />
        </div>
        <div className="wk-bot-manage-menu-item-disabled">
          <ListItem
            style={{}}
            title={labels.profileCommands}
            subTitle={
              <span className="wk-list-chevron">{labels.comingSoon}</span>
            }
          />
        </div>
      </div>
    </div>
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
            {enabledGroups.map((group) => (
              <MentionFreeRow
                key={group.groupNo}
                group={group}
                onToggleMentionFree={onToggleMentionFree}
              />
            ))}
          </>
        )}

        {otherGroups.length > 0 && (
          <>
            <div className="wk-bot-manage-section-title">
              {labels.sectionOthers}
            </div>
            {otherGroups.map((group) => (
              <MentionFreeRow
                key={group.groupNo}
                group={group}
                onToggleMentionFree={onToggleMentionFree}
              />
            ))}
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
  onToggleMentionFree,
}: {
  group: BotManageGroupItem;
  onToggleMentionFree: (
    groupNo: string,
    next: boolean,
    ctx?: ListItemSwitchContext,
  ) => void;
}) {
  return (
    <ListItemSwitch
      style={{}}
      title={group.name || group.groupNo}
      checked={group.noMention}
      onCheck={(next: boolean, ctx?: ListItemSwitchContext) => {
        onToggleMentionFree(group.groupNo, next, ctx);
      }}
    />
  );
}

export { BotManageView };
