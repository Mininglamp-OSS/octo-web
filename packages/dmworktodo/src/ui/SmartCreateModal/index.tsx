import React, { useState, useCallback } from 'react';
import './index.css';

export interface SmartCreateModalProps {
  /** 是否为空白新建（true = 手动填写，false = 从消息智能预填） */
  blank?: boolean;
  /** 智能创建时选中的消息数量 */
  count?: number;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 创建事项 */
  onCreate: (data: { title: string; brief: string; owners: string[]; due: string }) => void;
}

/**
 * SmartCreateModal — 新建事项 / 智能创建事项弹窗
 *
 * 对齐原型 v19 SmartCreateModal：
 * - 4 字段全部必填（标题 / 主要目标 / 负责人 / Deadline）
 * - blank 模式：手动填写
 * - 非 blank 模式：AI 已预填（TODO: 接 AI 蒸馏接口）
 */
export default function SmartCreateModal({ blank = true, count, onClose, onCreate }: SmartCreateModalProps) {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [due, setDue] = useState('');

  const canCreate = title.trim() && brief.trim() && due;

  const handleCreate = useCallback(() => {
    if (!canCreate) return;
    onCreate({ title: title.trim(), brief: brief.trim(), owners: [], due });
    onClose();
  }, [canCreate, title, brief, due, onCreate, onClose]);

  return (
    <div className="wk-scm-mask" onClick={onClose}>
      <div className="wk-scm" onClick={(e) => e.stopPropagation()}>
        {/* Head */}
        <div className="wk-scm__head">
          <div className="wk-scm__title">
            {!blank && (
              <span className="wk-scm__spark">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v4m0 14v-4m9-5h-4M3 12h4m12.3-5.3-2.8 2.8M7.5 16.5l-2.8 2.8m14.6 0-2.8-2.8M7.5 7.5 4.7 4.7" />
                </svg>
              </span>
            )}
            {blank ? '新建事项' : '智能创建事项'}
          </div>
          <div className="wk-scm__sub">
            {blank ? '手动填写 4 个必填字段' : `从 ${count} 条选中消息蒸馏 · 4 字段 AI 已预填, 全部必填`}
          </div>
        </div>

        {/* Body */}
        <div className="wk-scm__body">
          {/* 标题 */}
          <div className="wk-scm__field">
            <label className="wk-scm__label">
              标题 <span className="wk-scm__req">*</span>
            </label>
            <input
              className="wk-scm__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="事件标题"
            />
          </div>

          {/* 主要目标 */}
          <div className="wk-scm__field">
            <label className="wk-scm__label">
              主要目标 <span className="wk-scm__req">*</span>
            </label>
            <textarea
              className="wk-scm__textarea"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="一句话说清这件事"
            />
          </div>

          {/* 负责人 */}
          <div className="wk-scm__field">
            <label className="wk-scm__label">
              负责人 <span className="wk-scm__req">*</span>
              <span style={{ marginLeft: 6, color: 'var(--wk-text-tertiary, #71717a)', fontSize: 11 }}>支持多选</span>
            </label>
            {/* TODO(interaction): 接 MemberPicker 组件选择负责人 */}
            <div className="wk-scm__picker wk-scm__picker--empty">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>请选择负责人 (可多选)</span>
            </div>
          </div>

          {/* Deadline */}
          <div className="wk-scm__field">
            <label className="wk-scm__label">
              Deadline <span className="wk-scm__req">*</span>
            </label>
            <input
              type="date"
              className="wk-scm__input"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="wk-scm__foot">
          <button type="button" className="wk-scm__btn wk-scm__btn--cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="wk-scm__btn wk-scm__btn--primary"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            创建事项
          </button>
        </div>
      </div>
    </div>
  );
}

export { SmartCreateModal };
