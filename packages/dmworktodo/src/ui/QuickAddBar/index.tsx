import React, { useState, useCallback, useRef } from 'react';
import * as api from '../../api/todoApi';
import { useI18n } from '@octo/base';
import VoiceInputButton from '@octo/base/src/Components/VoiceInputButton';
import type { CreateMatterReq, Matter } from '../../bridge/types';
import CreateTaskModal from '../CreateTaskModal';
import { Toast } from '../../utils/toast';
import './index.css';

export interface QuickAddBarProps {
  channelId: string;
  channelType: number;
  channelName?: string;
  /** Called after a matter is optimistically inserted or confirmed created */
  onCreated: (matter: Matter) => void;
}

/**
 * QuickAddBar — 底部快速添加事项输入框。
 * - Enter：乐观插入假数据，后台创建，失败时回滚
 * - ⊕ 按钮：展开 CreateTaskModal 完整表单
 */
export default function QuickAddBar({
  channelId,
  channelType,
  channelName,
  onCreated,
}: QuickAddBarProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleQuickCreate = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || creating) return;

    // 乐观插入
    const optimisticMatter: Matter = {
      id: `__optimistic__${Date.now()}`,
      title: trimmed,
      status: 'open',
      space_id: '',
      creator_id: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_channel_id: channelId,
      source_channel_type: channelType,
      source_name: channelName,
    };
    onCreated(optimisticMatter);
    setTitle('');
    setCreating(true);

    try {
      const real = await api.createMatter({
        title: trimmed,
        source_channel_id: channelId,
        source_channel_type: channelType,
        source_name: channelName,
      });
      // 用真实数据替换乐观数据
      onCreated(real);
    } catch {
      Toast.error(t("todo.toast.createFailed"));
      // 回滚：通知父组件移除乐观条目（通过特殊 id 标识）
      onCreated({ ...optimisticMatter, id: `__rollback__${optimisticMatter.id}` });
    } finally {
      setCreating(false);
    }
  }, [title, creating, channelId, channelType, channelName, onCreated, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleQuickCreate();
      }
    },
    [handleQuickCreate],
  );

  const handleModalConfirm = useCallback(async (req: CreateMatterReq) => {
    const real = await api.createMatter(req);
    Toast.success(t("todo.toast.created"));
    onCreated(real);
    setShowModal(false);
  }, [onCreated, t]);

  return (
    <>
      <div className="wk-quick-add-bar">
        <input
          ref={inputRef}
          className="wk-quick-add-bar__input"
          type="text"
          placeholder={t("todo.quickAdd.placeholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={creating}
        />
        <VoiceInputButton
          inputRef={inputRef}
          onTranscribed={(text, mode, savedRange) => {
            if (mode === "all") {
              setTitle(text);
            } else if (mode === "selection" && savedRange) {
              // Note: savedRange indices are from recording start; assumes input is read-only during recording
              setTitle((prev) => prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to));
            } else {
              setTitle((prev) => {
                const pos = savedRange?.from ?? prev.length;
                return prev.slice(0, pos) + text + prev.slice(pos);
              });
            }
          }}
          size="sm"
        />
        <button
          type="button"
          className="wk-quick-add-bar__expand-btn"
          onClick={() => setShowModal(true)}
          title={t("todo.quickAdd.fullForm")}
        >
          ⊕
        </button>
      </div>

      <CreateTaskModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onDirtyClose={() => setShowModal(false)}
        onConfirm={handleModalConfirm}
        channel={{ channelId, channelType, name: channelName }}
      />
    </>
  );
}

export { QuickAddBar };
