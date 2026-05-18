import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Modal, DatePicker } from '@douyinfe/semi-ui';
import VoiceInputButton from '@octo/base/src/Components/VoiceInputButton';
import type { CreateMatterReq } from '../../bridge/types';
import MemberPicker from '../MemberPicker';
import './index.css';

// ─── Props 接口 ───────────────────────────────────────────

export interface CreateTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onDirtyClose: () => void;
  onConfirm: (req: CreateMatterReq) => Promise<void>;
  prefillTitle?: string;
  prefillAssigneeUids?: string[];
  /** 控制按钮文案：true 显示「发送并创建事项」*/
  sendOnConfirm?: boolean;

  channel?: { channelId: string; channelType: number; name?: string };
}

// ─── 本地日期格式化（避免 toISOString UTC 偏移）──────────────
/** YYYY-MM-DD → Date（按本地时区解析，避免 new Date('YYYY-MM-DD') UTC 跨天） */
function fromLocalDateString(s: string): Date {
  const [yyyy, mm, dd] = s.split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLocalTZOffset(): string {
  const off = new Date().getTimezoneOffset(); // e.g. -480 for +08:00
  const sign = off <= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const m = String(Math.abs(off) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

// ─── 快捷日期计算 ──────────────────────────────────────────

function getTodayEnd(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function getTomorrowEnd(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59, 999);
  return d;
}

// 返回「本周五」或「下周五」及对应日期
function getFridayInfo(): { label: string; date: Date } {
  const d = new Date();
  const day = d.getDay();
  // 中国习惯周一为周首，周五/周六/周日都视为"本周五已过"，跳下周五
  const isThisWeekFridayPast = day === 5 || day === 6 || day === 0;
  let daysUntilFriday: number;
  if (isThisWeekFridayPast) {
    daysUntilFriday = (5 - day + 7) % 7 || 7;
  } else {
    daysUntilFriday = 5 - day; // 周一(1)→4，周二(2)→3，周三(3)→2，周四(4)→1
  }
  const target = new Date(d);
  target.setDate(d.getDate() + daysUntilFriday);
  target.setHours(23, 59, 59, 999);
  return { label: isThisWeekFridayPast ? '下周五' : '本周五', date: target };
}

// ─── CreateTaskModal 主组件 ────────────────────────────────

export default function CreateTaskModal({
  visible,
  onClose,
  onDirtyClose,
  onConfirm,
  prefillTitle = '',
  prefillAssigneeUids = [],
  sendOnConfirm = false,
  channel,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState(prefillTitle);
  const [assigneeUids, setAssigneeUids] = useState<string[]>(prefillAssigneeUids);
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // 用 join 做稳定的 key，避免每次渲染新数组引用触发 effect（比 JSON.stringify 更轻量）
  const prefillAssigneeUidsKey = prefillAssigneeUids.join(',');
  // stablePrefillAssigneeUids：用 key 做稳定化，避免每次渲染新数组引用导致 isDirty useMemo 失效
  const stablePrefillAssigneeUids = useMemo(
    () => prefillAssigneeUids,
    [prefillAssigneeUidsKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ─── 快捷日期：在 visible 变为 true 时用 useEffect 计算，
  //     避免 useMemo 依赖 visible 语义不正确（visible=false 时也会重算）
  const [quickDates, setQuickDates] = useState(() => {
    const fri = getFridayInfo();
    return {
      today: toLocalDateString(getTodayEnd()),
      tomorrow: toLocalDateString(getTomorrowEnd()),
      friday: toLocalDateString(fri.date),
      fridayLabel: fri.label,
    };
  });

  // ─── 初始化：当 visible 变化时重置表单 + 聚焦确认按钮 ─────
  useEffect(() => {
    if (visible) {
      setTitle(prefillTitle);
      setAssigneeUids(prefillAssigneeUids);
      setDeadline('');
      setDescription('');
      setShowDescription(false);
      // visible=true 时重新计算日期，确保跨天/多次打开都是正确的
      const fri = getFridayInfo();
      setQuickDates({
        today: toLocalDateString(getTodayEnd()),
        tomorrow: toLocalDateString(getTomorrowEnd()),
        friday: toLocalDateString(fri.date),
        fridayLabel: fri.label,
      });
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
  // prefillAssigneeUidsKey = join(',')，内容不变时 key 相同，effect 不重跑
  }, [visible, prefillTitle, prefillAssigneeUidsKey]);

  // ─── dirty 检测 ────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (title.trim() !== prefillTitle.trim()) return true;
    if (assigneeUids.length !== stablePrefillAssigneeUids.length) return true;
    // 用 Set 比较，不依赖顺序（MemberPicker toggle 顺序可能与 prefill 不同）
    const prefillSet = new Set(stablePrefillAssigneeUids);
    if (assigneeUids.some((uid) => !prefillSet.has(uid))) return true;
    if (deadline) return true;
    if (description.trim()) return true;
    return false;
  }, [title, assigneeUids, deadline, description, prefillTitle, stablePrefillAssigneeUids]);

  // ─── 关闭处理 ──────────────────────────────────────────
  const handleClose = useCallback(() => {
    if (isDirty) {
      onDirtyClose();
    } else {
      onClose();
    }
  }, [isDirty, onClose, onDirtyClose]);

  // ─── 确认提交 ──────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || submitting) return;

    setSubmitting(true);
    try {
      const req: CreateMatterReq = {
        title: trimmedTitle,
        description: description.trim() || undefined,
        assignee_ids: assigneeUids.length > 0 ? assigneeUids : undefined,
        deadline: deadline ? `${deadline}T23:59:59${getLocalTZOffset()}` : undefined,
        source_channel_id: channel?.channelId,
        source_channel_type: channel?.channelType,
        source_name: channel?.name,
      };
      // 不在这里调 onClose，由调用方在 onConfirm 完成后控制关闭
      // 避免 onClose 被调用两次（调用方 + 这里各调一次）
      await onConfirm(req);
    } finally {
      setSubmitting(false);
    }
  }, [title, description, assigneeUids, deadline, submitting, onConfirm, channel]);

  // ─── 快捷日期选择 ──────────────────────────────────────
  const handleQuickDate = useCallback((type: 'today' | 'tomorrow' | 'friday' | 'custom') => {
    if (type === 'today') {
      setDeadline(quickDates.today);
    } else if (type === 'tomorrow') {
      setDeadline(quickDates.tomorrow);
    } else if (type === 'friday') {
      setDeadline(quickDates.friday);
    }
    // custom：不自动设置，让用户用 date picker 选
  }, [quickDates]);

  // ─── 键盘快捷键 ────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        // textarea / input（如 MemberPicker 搜索框）内 Enter 不触发提交
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'TEXTAREA') return;
        // INPUT 里只有 title input 允许 Enter 提交，其他 input（MemberPicker 搜索、DatePicker）不触发
        if (tag === 'INPUT' && e.target !== titleInputRef.current) return;
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleClose, handleConfirm]
  );

  return (
    <Modal
      visible={visible}
      onCancel={handleClose}
      footer={null}
      width={480}
      closable={false}
      maskClosable={false}
      centered
      className="wk-create-task-modal"
    >
      <div className="wk-create-task-modal__content" onKeyDown={handleKeyDown}>
        <h3 className="wk-create-task-modal__title">创建事项</h3>

        {/* 事项名 */}
        <div className="wk-create-task-modal__field">
          <label className="wk-create-task-modal__label">事项名</label>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              ref={titleInputRef}
              type="text"
              className={`wk-create-task-modal__input${sendOnConfirm ? ' wk-create-task-modal__input--readonly' : ''}`}
              placeholder="输入事项名称..."
              value={title}
              onChange={sendOnConfirm ? () => {} : (e) => setTitle(e.target.value)}
              readOnly={sendOnConfirm}
              autoFocus={false}
              style={{ flex: 1 }}
            />
            {!sendOnConfirm && (
              <VoiceInputButton
                inputRef={titleInputRef}
                onTranscribed={(text, mode, savedRange) => {
                  let newValue: string;
                  if (mode === "all") {
                    newValue = text;
                  } else if (mode === "selection" && savedRange) {
                    // Note: savedRange indices are from recording start; assumes input is read-only during recording
                    const prev = title;
                    newValue = prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to);
                  } else {
                    const prev = title;
                    const pos = savedRange?.from ?? prev.length;
                    newValue = prev.slice(0, pos) + text + prev.slice(pos);
                  }
                  setTitle(newValue.slice(0, 200));
                }}
                getCurrentText={() => title}
                size="sm"
              />
            )}
          </div>
        </div>

        {/* 负责人 */}
        <div className="wk-create-task-modal__field">
          <label className="wk-create-task-modal__label">负责人</label>
          <MemberPicker mode="controlled" value={assigneeUids} onChange={setAssigneeUids} channel={channel} placeholder="选择负责人..." />
        </div>

        {/* 截止日期 */}
        <div className="wk-create-task-modal__field">
          <label className="wk-create-task-modal__label">截止日期</label>
          <div className="wk-create-task-modal__date-shortcuts">
            <button
              type="button"
              className={`wk-create-task-modal__date-btn ${deadline === quickDates.today ? 'active' : ''}`}
              onClick={() => handleQuickDate('today')}
            >
              今天
            </button>
            <button
              type="button"
              className={`wk-create-task-modal__date-btn ${deadline === quickDates.tomorrow ? 'active' : ''}`}
              onClick={() => handleQuickDate('tomorrow')}
            >
              明天
            </button>
            <button
              type="button"
              className={`wk-create-task-modal__date-btn ${deadline === quickDates.friday ? 'active' : ''}`}
              onClick={() => handleQuickDate('friday')}
            >
              {quickDates.fridayLabel}
            </button>

          </div>
          <DatePicker
            className="wk-create-task-modal__datepicker"
            style={{ width: '100%' }}
            value={deadline ? fromLocalDateString(deadline) : undefined}
            onChange={(date) => {
              if (!date) { setDeadline(''); return; }
              const d = date instanceof Date ? date : fromLocalDateString(String(date));
              // 用本地年月日，避免 toISOString() UTC 转换导致日期退一天
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              setDeadline(`${yyyy}-${mm}-${dd}`);
            }}
            disabledDate={(date) => !!date && date < new Date(new Date().setHours(0,0,0,0))}
            placeholder="选择截止日期"
            density="compact"
          />
        </div>

        {/* 备注（折叠） */}
        <div className="wk-create-task-modal__field">
          {!showDescription ? (
            <button type="button" className="wk-create-task-modal__toggle-desc" onClick={() => setShowDescription(true)}>
              + 添加备注
            </button>
          ) : (
            <>
              <label className="wk-create-task-modal__label">备注</label>
              <div style={{ position: "relative" }}>
                <textarea
                  ref={descRef}
                  className="wk-create-task-modal__textarea"
                  placeholder="添加事项备注..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
                <VoiceInputButton
                  inputRef={descRef}
                  onTranscribed={(text, mode, savedRange) => {
                    if (mode === "all") {
                      setDescription(text);
                    } else if (mode === "selection" && savedRange) {
                      // Note: savedRange indices are from recording start; assumes input is read-only during recording
                      setDescription(prev => prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to));
                    } else {
                      setDescription(prev => {
                        const pos = savedRange?.from ?? prev.length;
                        return prev.slice(0, pos) + text + prev.slice(pos);
                      });
                    }
                  }}
                  getCurrentText={() => description}
                  showModeMenu
                  size="sm"
                  className="wk-vib--textarea-corner"
                />
              </div>
            </>
          )}
        </div>

        {/* 按钮组 */}
        <div className="wk-create-task-modal__actions">
          <button type="button" className="wk-create-task-modal__btn wk-create-task-modal__btn--cancel" onClick={handleClose}>
            取消 <span className="wk-create-task-modal__shortcut">Esc</span>
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className="wk-create-task-modal__btn wk-create-task-modal__btn--confirm"
            onClick={handleConfirm}
            disabled={!title.trim() || submitting}
          >
            {sendOnConfirm ? '发送并创建事项' : '创建事项'} <span className="wk-create-task-modal__shortcut">↵</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
