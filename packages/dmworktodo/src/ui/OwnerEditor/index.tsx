import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import WKAvatar from '@octo/base/src/Components/WKAvatar';
import { Channel, ChannelTypePerson } from 'wukongimjssdk';
import type { MatterAssignee } from '../../bridge/types';
import {
    useMembersFromChannels,
    ChannelRef,
} from '../../hooks/useMembersFromChannels';
import { useUserName } from '../../hooks/useUserName';
import './index.css';

/**
 * OwnerEditor — 负责人编辑器（对齐原型 v19 OwnersEditor）
 *
 * 权限规则 (17-Matters-数据流修正-v0.7.md §5.1 / §5.2):
 *   - 编辑权限: 仅发起人 (creator) 或当前负责人 (assignees 之一) 可修改
 *     ——权限矩阵里没直接列 "改负责人", 按 "改状态" / "删全部" 的梯度推导
 *   - 至少保留 1 位负责人, 不能全部移除
 *   - 候选人范围: Matter 关联的所有 channel 成员的并集
 *     ——§5.1 "关联 channel 成员自动继承 Matter access", 负责人应当从有 access
 *       的人里选, 避免指派给看不见 Matter 的人
 *
 * 交互:
 *   - 点头像行 → 弹下拉
 *   - 候选列表来自 Matter 所有关联 channel 的成员并集 (useMembersFromChannels)
 *   - 点候选项 → toggle 添加 / 移除
 */

export interface OwnerEditorProps {
    assignees: MatterAssignee[];
    /** 当前用户是否有编辑权限 */
    canEdit: boolean;
    /**
     * 候选成员来源 channel 列表。一般传 Matter 关联的所有 channel
     * (matter.channels + source_channel, 去重后)。
     * 空数组时下拉只显示当前 assignees (保证可以移除)。
     */
    candidateChannels: ChannelRef[];
    /** 切换负责人回调 */
    onToggle: (uid: string, isCurrentlyAssigned: boolean) => Promise<void>;
}

// ─── 下拉项 ───────────────────────────────────────────

function OwnerOption({
  uid,
  name,
  picked,
  onClick,
  disabled,
}: {
  uid: string;
  name: string;
  picked: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`wk-owner-editor__option${picked ? ' is-picked' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? '至少保留 1 位负责人' : undefined}
    >
      <WKAvatar
        channel={new Channel(uid, ChannelTypePerson)}
        style={{ width: 16, height: 16 }}
      />
      <span className="wk-owner-editor__option-name">{name}</span>
      {picked && <span className="wk-owner-editor__option-check">✓</span>}
    </button>
  );
}

// Option 里 name 要走 useUserName hook，但 hook 不能在循环里直接调；
// 拆子组件包 hook，才能为每个候选独立订阅 UserName。
function OwnerOptionConnected({
  uid,
  picked,
  onClick,
  disabled,
  fallbackName,
}: {
  uid: string;
  picked: boolean;
  onClick: () => void;
  disabled?: boolean;
  fallbackName?: string;
}) {
  const resolved = useUserName(uid);
  const name = resolved || fallbackName || uid;
  return <OwnerOption uid={uid} name={name} picked={picked} onClick={onClick} disabled={disabled} />;
}

// ─── 主组件 ───────────────────────────────────────────

export default function OwnerEditor({
    assignees,
    canEdit,
    candidateChannels,
    onToggle,
}: OwnerEditorProps) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState<Set<string>>(new Set());
    const ref = useRef<HTMLSpanElement>(null);

    // 关闭下拉
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node))
                setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    // 候选成员（仅 open 时加载）: Matter 所有关联 channel 成员的并集
    const { members } = useMembersFromChannels(candidateChannels, {
        enabled: open,
    });

  const assignedUids = useMemo(() => new Set(assignees.map((a) => a.user_id)), [assignees]);

  // 合并候选列表：当前负责人 + 成员列表（去重）
  // 保证即使成员列表未包含当前负责人（比如跨群），也能看到并取消选择
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const list: { uid: string; name?: string }[] = [];
    for (const a of assignees) {
      if (seen.has(a.user_id)) continue;
      seen.add(a.user_id);
      list.push({ uid: a.user_id });
    }
    for (const m of members) {
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      list.push({ uid: m.uid, name: m.name });
    }
    return list;
  }, [assignees, members]);

  const handleToggle = useCallback(
    async (uid: string) => {
      if (pending.has(uid)) return;
      const picked = assignedUids.has(uid);
      // 至少保留 1 位：如果要移除的是最后一位，拒绝
      if (picked && assignees.length <= 1) return;

      setPending((prev) => {
        const next = new Set(prev);
        next.add(uid);
        return next;
      });
      try {
        await onToggle(uid, picked);
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      }
    },
    [assignedUids, assignees.length, onToggle, pending],
  );

  const triggerClass = `wk-owner-editor__trigger${canEdit ? '' : ' is-readonly'}`;
  const triggerProps = canEdit
    ? { onClick: () => setOpen((o) => !o), type: 'button' as const }
    : {
                type: 'button' as const,
                disabled: true,
                title: '仅发起人或当前负责人可修改',
            };

  return (
    <span className="wk-owner-editor" ref={ref}>
      <button {...triggerProps} className={triggerClass}>
        <span className="wk-owner-editor__avatars">
          {assignees.map((a, i) => (
            <span
              key={a.user_id}
              className="wk-owner-editor__avatar-wrap"
              style={{
                marginLeft: i > 0 ? -6 : 0,
                zIndex: assignees.length - i,
              }}
            >
              <WKAvatar
                channel={new Channel(a.user_id, ChannelTypePerson)}
                style={{ width: 16, height: 16 }}
              />
            </span>
          ))}
        </span>
        <span className="wk-owner-editor__names">
          {assignees.map((a, i) => (
            <React.Fragment key={a.user_id}>
              {i > 0 && '、'}
              <OwnerNameInline uid={a.user_id} />
            </React.Fragment>
          ))}
        </span>
      </button>

            {open && canEdit && (
                <div className="wk-owner-editor__dropdown">
                    <div className="wk-owner-editor__hint">
                        多选 · 至少保留 1 位
                    </div>
                    <div className="wk-owner-editor__hint wk-owner-editor__hint--sub">
                        候选人来自 Matter 关联的群
                    </div>
                    {candidates.length === 0 && (
                        <div className="wk-owner-editor__empty">
                            暂无可选成员
                        </div>
                    )}
                    {candidates.map((c) => {
                        const picked = assignedUids.has(c.uid);
                        const isLast = picked && assignees.length <= 1;
                        const isPending = pending.has(c.uid);
                        return (
                            <OwnerOptionConnected
                                key={c.uid}
                                uid={c.uid}
                                picked={picked}
                                onClick={() => handleToggle(c.uid)}
                                disabled={isLast || isPending}
                                fallbackName={c.name}
                            />
                        );
                    })}
                </div>
            )}
    </span>
  );
}

// 内联的 UserName（避免引进外层 UserName 组件的 className 约束）
function OwnerNameInline({ uid }: { uid: string }) {
  const name = useUserName(uid);
  return <>{name || uid}</>;
}
