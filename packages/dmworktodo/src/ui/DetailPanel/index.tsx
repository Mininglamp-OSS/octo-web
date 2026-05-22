import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WKApp } from '@octo/base';
import { Channel } from 'wukongimjssdk';
import * as api from '../../api/todoApi';
import type { MatterDetail, MatterComment } from '../../bridge/types';
import UserName from '../UserName';
import { Toast } from '../../utils/toast';
import './index.css';

// ─── Props 接口 ───────────────────────────────────────────

export interface DetailPanelProps {
  matterId: string;
  onClose?: () => void;
  onStatusChanged?: () => void;
  channel?: { channelId: string; channelType: number };
}

// ─── 状态标签颜色 ─────────────────────────────────────────
const STATUS_TAG: Record<string, { label: string; cls: string }> = {
  open: { label: '进行中', cls: 'wk-matter-side-panel__header-tag--blue' },
  done: { label: '已完成', cls: 'wk-matter-side-panel__header-tag--green' },
  archived: { label: '已归档', cls: 'wk-matter-side-panel__header-tag--gray' },
};

function formatDeadlineDisplay(deadline: string): string {
  const d = new Date(deadline);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `截止到 ${d.getMonth() + 1}/${d.getDate()} ${weekdays[d.getDay()]}`;
}

// ─── DetailPanel 主组件 ────────────────────────────────────

export default function DetailPanel({ matterId, onClose, onStatusChanged, channel }: DetailPanelProps) {
  const [matter, setMatter] = useState<MatterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<MatterComment[]>([]);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const commentsCursorRef = useRef<string | undefined>();
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [updatingTitle, setUpdatingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const loadComments = useCallback(async (append = false) => {
    try {
      const res = await api.listComments(matterId, {
        source_channel_id: channel?.channelId,
        limit: 50,
        cursor: append ? commentsCursorRef.current : undefined,
      });
      const items = res?.data ?? [];
      setComments(append ? (prev) => [...prev, ...items] : items);
      setCommentsHasMore(res?.pagination?.has_more ?? false);
      commentsCursorRef.current = res?.pagination?.next_cursor;
    } catch {
      if (!append) { setComments([]); Toast.error('加载评论失败'); }
      else Toast.error('加载评论失败');
    }
  }, [matterId, channel?.channelId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.getMatter(matterId, channel?.channelId);
      setMatter(t);
    } catch {
      Toast.error('加载事项失败');
    } finally {
      setLoading(false);
    }
  }, [matterId, channel?.channelId]);

  useEffect(() => { load(); loadComments(false); }, [load, loadComments]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleToggleStatus = useCallback(async () => {
    if (!matter || matter.status === 'archived') return;
    const oldStatus = matter.status;
    const newStatus = oldStatus === 'open' ? 'done' : 'open';
    setMatter((prev) => prev ? { ...prev, status: newStatus } : prev);
    try {
      await api.transitionMatter(matter.id, newStatus);
      onStatusChanged?.();
    } catch {
      setMatter((prev) => prev ? { ...prev, status: oldStatus } : prev);
      Toast.error('更新状态失败');
    }
  }, [matter, onStatusChanged]);

  const handleStartEditTitle = useCallback(() => {
    if (!matter || matter.status === 'archived') return;
    setEditTitleValue(matter.title);
    setIsEditingTitle(true);
  }, [matter]);

  const handleSaveTitle = useCallback(async () => {
    if (!matter || updatingTitle) return;
    const newTitle = editTitleValue.trim();
    if (!newTitle || newTitle === matter.title) { setIsEditingTitle(false); return; }
    setUpdatingTitle(true);
    try {
      const updated = await api.updateMatter(matterId, { title: newTitle });
      setMatter(updated);
      setIsEditingTitle(false);
      onStatusChanged?.();
    } catch { Toast.error('更新标题失败'); }
    finally { setUpdatingTitle(false); }
  }, [matter, editTitleValue, matterId, updatingTitle, onStatusChanged]);

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.addComment(matterId, newComment.trim());
      setNewComment('');
      await loadComments(false);
    } catch { Toast.error('添加评论失败'); }
    finally { setSubmitting(false); }
  }, [matterId, newComment, submitting, loadComments]);

  const statusTag = matter ? (STATUS_TAG[matter.status] || STATUS_TAG.open) : STATUS_TAG.open;

  return (
    <div className="wk-matter-side-panel">
      {/* ─── Header ─── */}
      <div className="wk-matter-side-panel__header">
        <div className="wk-matter-side-panel__header-left">
          {matter && (
            <>
              <span className={`wk-matter-side-panel__header-tag ${statusTag.cls}`}>
                <span className="wk-matter-side-panel__header-tag-label">{statusTag.label}</span>
                {matter.seq_no ? <span className="wk-matter-side-panel__header-tag-no">｜M-{matter.seq_no}</span> : null}
              </span>
              {matter.deadline && (
                <span className="wk-matter-side-panel__header-ddl">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M5.33 1.33v2M10.67 1.33v2M2 6h12M3.33 3.33h9.34a1.33 1.33 0 011.33 1.34v8a1.33 1.33 0 01-1.33 1.33H3.33A1.33 1.33 0 012 12.67v-8a1.33 1.33 0 011.33-1.34z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {formatDeadlineDisplay(matter.deadline)}
                </span>
              )}
            </>
          )}
        </div>
        <div className="wk-matter-side-panel__header-actions">
          {matter && matter.status !== 'archived' && (
            <button type="button" className="wk-matter-side-panel__header-btn" onClick={handleToggleStatus} title={matter.status === 'open' ? '标记完成' : '重新打开'}>
              {matter.status === 'open' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.67 8A5.33 5.33 0 018 2.67M13.33 8A5.33 5.33 0 018 13.33M8 2.67l1.33 2M8 13.33l-1.33-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          )}
          {onClose && (
            <button type="button" className="wk-matter-side-panel__header-btn" onClick={onClose} aria-label="关闭">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ─── Body ─── */}
      <div className="wk-matter-side-panel__body">
        {loading && <div className="wk-matter-detail__loading">加载中...</div>}
        {!loading && !matter && <div className="wk-matter-detail__loading">加载事项失败，请重试</div>}
        {!loading && matter && (
          <div className="wk-matter-detail__content">
            {/* Title + Meta */}
            <div className="wk-matter-detail__section">
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  className="wk-matter-detail__title-input"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                />
              ) : (
                <h2 className="wk-matter-detail__title" onClick={handleStartEditTitle} title="点击编辑标题">
                  {matter.title.replace(/@\[([^:]*):([^\]]*)\]/g, (_m, _uid, name) => `@${name}`)}
                </h2>
              )}

              {/* 🎯 主要目标 */}
              {matter.description && (
                <>
                  <div className="wk-matter-detail__goal-label">
                    🎯 <span>主要目标</span>
                  </div>
                  {matter.source_channel_id && matter.source_name && (
                    <div className="wk-matter-detail__source">
                      <svg className="wk-matter-detail__source-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4l6 4 6-4M2 4v8l6 4 6-4V4M2 4l6-4 6 4" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                      </svg>
                      来自 #{matter.source_name}
                    </div>
                  )}
                  <div className="wk-matter-detail__description">{matter.description}</div>
                </>
              )}

              {/* 创建人 + 负责人 */}
              <div className="wk-matter-detail__people">
                <div className="wk-matter-detail__people-item">
                  <span className="wk-matter-detail__people-label">创建人：</span>
                  <span className="wk-matter-detail__people-tag">
                    <UserName uid={matter.creator_id} />
                  </span>
                </div>
                {matter.assignees && matter.assignees.length > 0 && (
                  <div className="wk-matter-detail__people-item">
                    <span className="wk-matter-detail__people-label">负责人：</span>
                    {matter.assignees.slice(0, 2).map((a) => (
                      <span key={a.user_id} className="wk-matter-detail__people-tag">
                        <UserName uid={a.user_id} />
                      </span>
                    ))}
                    {matter.assignees.length > 2 && (
                      <span className="wk-matter-detail__people-more">+{matter.assignees.length - 2}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tabs + 关联群聊 */}
            <div className="wk-matter-detail__section">
              <div className="wk-matter-detail__tabs">
                <button type="button" className="wk-matter-detail__tab is-active">
                  关联群聊 {matter.channels?.length || 0}
                </button>
                <button type="button" className="wk-matter-detail__tab">
                  变更记录
                </button>
              </div>

              {/* 关联频道列表 */}
              {matter.channels && matter.channels.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wk-sp-3)' }}>
                  {matter.channels.map((ch) => (
                    <div key={ch.id} className="wk-matter-detail__channel-card">
                      <div className="wk-matter-detail__channel-card-header">
                        <div className="wk-matter-detail__channel-card-info">
                          <span className="wk-matter-detail__channel-card-name">#{ch.channel_name || ch.channel_id}</span>
                        </div>
                        <button
                          type="button"
                          className="wk-matter-detail__channel-card-action"
                          onClick={() => WKApp.endpoints.showConversation(new Channel(ch.channel_id, ch.channel_type))}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.33h-2A1.33 1.33 0 002.67 4.67v8A1.33 1.33 0 004 14h8a1.33 1.33 0 001.33-1.33v-2M9.33 2h4.67v4.67M6.67 9.33L14 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          查看群聊
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 评论区 */}
        {!loading && matter && comments.length > 0 && (
          <div className="wk-matter-detail__comments">
            {comments.map((c) => (
              <div key={c.id} className="wk-matter-detail__comment">
                <div className="wk-matter-detail__comment-body">
                  <div className="wk-matter-detail__comment-header">
                    <span className="wk-matter-detail__comment-name"><UserName uid={c.user_id} /></span>
                    <span className="wk-matter-detail__comment-time">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                  {c.content && <div className="wk-matter-detail__comment-content">{c.content}</div>}
                </div>
              </div>
            ))}
            {commentsHasMore && (
              <button type="button" className="wk-matter-detail__channel-msg-expand" onClick={() => loadComments(true)}>
                加载更多评论...
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── 评论输入 ─── */}
      {!loading && matter && (
        <div className="wk-matter-detail__comment-input">
          <input
            type="text"
            placeholder="添加评论..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
          />
          <button
            type="button"
            className="wk-matter-detail__comment-send"
            onClick={handleAddComment}
            disabled={!newComment.trim() || submitting}
          >
            发送
          </button>
        </div>
      )}
    </div>
  );
}

export { DetailPanel };
