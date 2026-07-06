import React from 'react';
import { useI18n } from '@octo/base';
import { Channel, ChannelTypePerson } from 'wukongimjssdk';
import type { Matter } from '../../bridge/types';
import WKAvatar from '@octo/base/src/Components/WKAvatar';
import { replaceMentions } from '../../utils/mention';
import './index.css';

export interface MatterCardProps {
  matter: Matter;
  channelName?: string;
  assigneeUids?: string[];
  creatorUid?: string;
  creatorName?: string;
  selected?: boolean;
  onClick?: (matterId: string) => void;
  className?: string;
}

// ─── 状态 → 标签颜色映射 ───────────────────────────────────
interface StatusTagInfo {
  labelKey: string;
  colorClass: string;
}

function getStatusTag(matter: Matter): StatusTagInfo {
  switch (matter.status) {
    case 'open':
      return { labelKey: 'todo.status.open', colorClass: 'wk-matter-card__tag--blue' };
    case 'done':
      return { labelKey: 'todo.status.done', colorClass: 'wk-matter-card__tag--green' };
    case 'archived':
      return { labelKey: 'todo.status.archived', colorClass: 'wk-matter-card__tag--gray' };
    default:
      return { labelKey: 'todo.status.open', colorClass: 'wk-matter-card__tag--blue' };
  }
}

// ─── 格式化 deadline 为 M/D ─────────────────────────────────
function formatDeadlineShort(deadline: string): string {
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isOverdue(deadline: string): boolean {
  const d = new Date(deadline);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

// ─── 日历 SVG 图标 ──────────────────────────────────────────
function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="wk-matter-card__calendar-icon">
      <path
        d="M4 1v1.5M8 1v1.5M1.5 4.5h9M2.5 2.5h7a1 1 0 011 1v6a1 1 0 01-1 1h-7a1 1 0 01-1-1v-6a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MatterCard({
  matter,
  channelName,
  assigneeUids = [],
  creatorUid,
  creatorName,
  selected = false,
  onClick,
  className,
}: MatterCardProps) {
  const { t } = useI18n();
  const handleClick = () => {
    if (onClick) onClick(matter.id);
  };

  const statusTag = getStatusTag(matter);
  const matterNo = matter.seq_no ? `M-${matter.seq_no}` : '';
  const overdue = matter.deadline ? isOverdue(matter.deadline) : false;

  return (
    <div
      className={`wk-matter-card${selected ? ' wk-matter-card--selected' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
    >
      {/* 第一行：状态标签 + 日期 */}
      <div className="wk-matter-card__row-1">
        <span className={`wk-matter-card__tag ${statusTag.colorClass}`}>
          <span className="wk-matter-card__tag-label">{t(statusTag.labelKey)}</span>
          {matterNo && (
            <span className="wk-matter-card__tag-no">｜{matterNo}</span>
          )}
        </span>
        {matter.deadline && (
          <div className={`wk-matter-card__deadline${overdue ? ' wk-matter-card__deadline--overdue' : ''}`}>
            <CalendarIcon />
            <span>{formatDeadlineShort(matter.deadline)}</span>
          </div>
        )}
      </div>

      {/* 第二行：事项标题 */}
      <div className={`wk-matter-card__title${matter.status === 'done' ? ' wk-matter-card__title--done' : matter.status === 'archived' ? ' wk-matter-card__title--archived' : ''}`}>
        {replaceMentions(matter.title)}
      </div>

      {/* 第三行：创建人 + 负责人 */}
      <div className="wk-matter-card__meta">
        {creatorUid && (
          <div className="wk-matter-card__meta-item">
            <span className="wk-matter-card__meta-label">{t("todo.label.creator")}</span>
            <div className="wk-matter-card__user">
              <WKAvatar
                channel={new Channel(creatorUid, ChannelTypePerson)}
                style={{ width: 16, height: 16, borderRadius: '50%' }}
              />
              {creatorName && <span className="wk-matter-card__user-name">{creatorName}</span>}
            </div>
          </div>
        )}
        {assigneeUids.length > 0 && (
          <div className="wk-matter-card__meta-item">
            <span className="wk-matter-card__meta-label">{t("todo.label.assignee")}</span>
            <div className="wk-matter-card__user">
              <div className="wk-matter-card__avatar-group">
                {assigneeUids.slice(0, 3).map((uid) => (
                  <WKAvatar
                    key={uid}
                    channel={new Channel(uid, ChannelTypePerson)}
                    style={{ width: 16, height: 16, borderRadius: '50%' }}
                  />
                ))}
              </div>
              {assigneeUids.length > 1 && (
                <span className="wk-matter-card__assignee-text">
                  {t("todo.assignee.count", { values: { count: assigneeUids.length } })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { MatterCard };
