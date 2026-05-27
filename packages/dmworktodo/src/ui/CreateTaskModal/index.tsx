import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Modal, DatePicker } from '@douyinfe/semi-ui';
import VoiceInputButton from '@octo/base/src/Components/VoiceInputButton';
import { useI18n } from '@octo/base';
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
  const { t } = useI18n();
  const [title, setTitle] = useState(prefillTitle);
  const [assigneeUids, setAssigneeUids] = useState<string[]>(prefillAssigneeUids);
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const prefillAssigneeUidsKey = prefillAssigneeUids.join(',');
  const stablePrefillAssigneeUids = useMemo(
    () => prefillAssigneeUids,
    [prefillAssigneeUidsKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ─── 初始化：当 visible 变化时重置表单 ─────
  useEffect(() => {
    if (visible) {
      setTitle(prefillTitle);
      setAssigneeUids(prefillAssigneeUids);
      setDeadline('');
      setDescription('');
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [visible, prefillTitle, prefillAssigneeUidsKey]);

  // ─── dirty 检测 ────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (title.trim() !== prefillTitle.trim()) return true;
    if (assigneeUids.length !== stablePrefillAssigneeUids.length) return true;
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
    if (!trimmedTitle || !description.trim() || assigneeUids.length === 0 || !deadline || submitting) return;

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
      await onConfirm(req);
    } finally {
      setSubmitting(false);
    }
  }, [title, description, assigneeUids, deadline, submitting, onConfirm, channel]);

  // ─── 键盘快捷键 ────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'TEXTAREA') return;
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
      <div className="wk-create-task-modal__wrap" onKeyDown={handleKeyDown}>
        {/* ─── Header ─── */}
        <div className="wk-create-task-modal__header">
          <h3 className="wk-create-task-modal__title">{t("todo.create.title")}</h3>
          <button
            type="button"
            className="wk-create-task-modal__close-btn"
            onClick={handleClose}
            aria-label={t("todo.common.close")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* ─── Content ─── */}
        <div className="wk-create-task-modal__content">
          {/* 事项名称 */}
          <div className="wk-create-task-modal__field">
            <label className="wk-create-task-modal__label">
              {t("todo.field.title")}<span className="wk-create-task-modal__required">*</span>
            </label>
            <div className="wk-create-task-modal__input-wrap">
              <input
                ref={titleInputRef}
                type="text"
                className={`wk-create-task-modal__input${sendOnConfirm ? ' wk-create-task-modal__input--readonly' : ''}`}
                placeholder={t("todo.common.inputPlaceholder")}
                value={title}
                onChange={sendOnConfirm ? () => {} : (e) => setTitle(e.target.value)}
                readOnly={sendOnConfirm}
                autoFocus={false}
              />
              {!sendOnConfirm && (
                <VoiceInputButton
                  inputRef={titleInputRef}
                  onTranscribed={(text, mode, savedRange) => {
                    let newValue: string;
                    if (mode === "all") {
                      newValue = text;
                    } else if (mode === "selection" && savedRange) {
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

          {/* 主要目标 */}
          <div className="wk-create-task-modal__field">
            <label className="wk-create-task-modal__label">
              {t("todo.field.goal")}<span className="wk-create-task-modal__required">*</span>
            </label>
            <div className="wk-create-task-modal__textarea-wrap">
              <textarea
                ref={descRef}
                className="wk-create-task-modal__textarea"
                placeholder={t("todo.field.goalPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                rows={3}
                maxLength={200}
              />
              <span className="wk-create-task-modal__char-count">
                {description.length}/200
              </span>
              <VoiceInputButton
                inputRef={descRef}
                onTranscribed={(text, mode, savedRange) => {
                  if (mode === "all") {
                    setDescription(text.slice(0, 200));
                  } else if (mode === "selection" && savedRange) {
                    setDescription(prev => {
                      const result = prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to);
                      return result.slice(0, 200);
                    });
                  } else {
                    setDescription(prev => {
                      const pos = savedRange?.from ?? prev.length;
                      const result = prev.slice(0, pos) + text + prev.slice(pos);
                      return result.slice(0, 200);
                    });
                  }
                }}
                getCurrentText={() => description}
                showModeMenu
                size="sm"
                className="wk-vib--textarea-corner"
              />
            </div>
          </div>

          {/* 负责人 */}
          <div className="wk-create-task-modal__field">
            <label className="wk-create-task-modal__label">
              {t("todo.field.assignee")}<span className="wk-create-task-modal__required">*</span>
            </label>
            <MemberPicker
              mode="controlled"
              value={assigneeUids}
              onChange={setAssigneeUids}
              channel={channel}
              placeholder={t("todo.common.selectPlaceholder")}
            />
          </div>

          {/* Deadline */}
          <div className="wk-create-task-modal__field">
            <label className="wk-create-task-modal__label">
              Deadline<span className="wk-create-task-modal__required">*</span>
            </label>
            <DatePicker
              className="wk-create-task-modal__datepicker"
              style={{ width: '100%' }}
              value={deadline ? fromLocalDateString(deadline) : undefined}
              onChange={(date) => {
                if (!date) { setDeadline(''); return; }
                const d = date instanceof Date ? date : fromLocalDateString(String(date));
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                setDeadline(`${yyyy}-${mm}-${dd}`);
              }}
              disabledDate={(date) => !!date && date < new Date(new Date().setHours(0,0,0,0))}
              placeholder={t("todo.common.selectPlaceholder")}
              density="compact"
            />
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="wk-create-task-modal__footer">
          <button
            type="button"
            className="wk-create-task-modal__btn wk-create-task-modal__btn--cancel"
            onClick={handleClose}
          >
            {t("todo.common.cancel")}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className="wk-create-task-modal__btn wk-create-task-modal__btn--confirm"
            onClick={handleConfirm}
            disabled={!title.trim() || !description.trim() || assigneeUids.length === 0 || !deadline || submitting}
          >
            {sendOnConfirm ? t("todo.create.sendAndCreate") : t("todo.common.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { CreateTaskModal };
