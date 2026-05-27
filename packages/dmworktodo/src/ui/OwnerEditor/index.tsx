import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useI18n } from '@octo/base';
import type { MatterAssignee } from '../../bridge/types';
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
 *   - 候选列表来自 Matter 所有关联 channel 的成员并集 (由调用方预解析传入)
 *   - 点候选项 → toggle 添加 / 移除
 */

export interface OwnerEditorProps {
    assignees: MatterAssignee[];
    /** 当前用户是否有编辑权限 (打开下拉框) */
    canEdit: boolean;
    /** 当前用户 UID (用于细粒度移除权限判断) */
    currentUid: string;
    /** 当前用户是否是 Matter 发起人 (creator 能移除任何人, 非 creator 只能移除自己) */
    isCreator: boolean;
    /**
     * 候选成员列表（由调用方预解析）。一般是 Matter 关联的所有 channel 成员的并集。
     * 空数组时下拉只显示当前 assignees (保证可以移除)。
     */
    candidates: Array<{ uid: string; name?: string }>;
    /** 切换负责人回调 */
    onToggle: (uid: string, isCurrentlyAssigned: boolean) => Promise<void>;
    /** Render an avatar for the given uid at the given pixel size */
    renderAvatar: (uid: string, size: number) => React.ReactNode;
    /** Resolve a user name for display. Falls back to uid if not provided or returns empty. */
    resolveUserName?: (uid: string) => string;
}

// ─── 下拉项 ───────────────────────────────────────────

function OwnerOption({
  uid,
  name,
  picked,
  onClick,
  disabled,
  renderAvatar,
}: {
  uid: string;
  name: string;
  picked: boolean;
  onClick: () => void;
  disabled?: boolean;
  renderAvatar: (uid: string, size: number) => React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`wk-owner-editor__option${picked ? ' is-picked' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t("todo.owner.keepOne") : undefined}
    >
      <span className="wk-owner-editor__option-tick">
        {picked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {renderAvatar(uid, 20)}
      <span className="wk-owner-editor__option-name">{name}</span>
    </button>
  );
}

// ─── 主组件 ───────────────────────────────────────────

export default function OwnerEditor({
    assignees,
    canEdit,
    currentUid,
    isCreator,
    candidates,
    onToggle,
    renderAvatar,
    resolveUserName,
}: OwnerEditorProps) {
    const { t } = useI18n();
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

  const assignedUids = useMemo(() => new Set(assignees.map((a) => a.user_id)), [assignees]);

  // 合并候选列表：当前负责人 + candidates（去重）
  // 保证即使 candidates 未包含当前负责人（比如跨群），也能看到并取消选择
  const mergedCandidates = useMemo(() => {
    const seen = new Set<string>();
    const list: { uid: string; name?: string }[] = [];
    for (const a of assignees) {
      if (seen.has(a.user_id)) continue;
      seen.add(a.user_id);
      list.push({ uid: a.user_id });
    }
    for (const c of candidates) {
      if (seen.has(c.uid)) continue;
      seen.add(c.uid);
      list.push({ uid: c.uid, name: c.name });
    }
    return list;
  }, [assignees, candidates]);

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

  const resolveName = useCallback(
    (uid: string, fallback?: string): string => {
      if (resolveUserName) {
        const resolved = resolveUserName(uid);
        if (resolved) return resolved;
      }
      return fallback || uid;
    },
    [resolveUserName],
  );

  const triggerClass = `wk-owner-editor__trigger${canEdit ? '' : ' is-readonly'}`;
  const triggerProps = canEdit
    ? { onClick: () => setOpen((o) => !o), type: 'button' as const }
    : {
        type: 'button' as const,
        disabled: true,
        title: t("todo.owner.readonly"),
      };

  return (
    <span className="wk-owner-editor" ref={ref}>
      <span className="wk-owner-editor__tags">
        {assignees.slice(0, 2).map((a) => (
          <button
            key={a.user_id}
            {...triggerProps}
            className={triggerClass}
          >
            {renderAvatar(a.user_id, 16)}
            <OwnerNameInline uid={a.user_id} resolveName={resolveName} />
          </button>
        ))}
        {assignees.length > 2 && (
          <span className="wk-owner-editor__more" onClick={canEdit ? () => setOpen((o) => !o) : undefined}>
            +{assignees.length - 2}
          </span>
        )}
      </span>

      {open && canEdit && (
        <div className="wk-owner-editor__dropdown">
          {mergedCandidates.length === 0 && (
            <div className="wk-owner-editor__empty">
              {t("todo.member.empty")}
            </div>
          )}
          {mergedCandidates.map((c) => {
            const picked = assignedUids.has(c.uid);
            const isLast = picked && assignees.length <= 1;
            const isPending = pending.has(c.uid);
            // 移除权限 (对齐后端 RemoveAssignee):
            //   - creator 能移除任何人
            //   - 非 creator 只能移除自己 (self-unassign)
            //   - 添加不受此限制 (AddAssignee: creator OR assignee)
            const canRemoveThis = picked
              ? isCreator || c.uid === currentUid
              : true;
            const disabled =
              isLast || isPending || (picked && !canRemoveThis);
            return (
              <OwnerOption
                key={c.uid}
                uid={c.uid}
                name={resolveName(c.uid, c.name)}
                picked={picked}
                onClick={() => handleToggle(c.uid)}
                disabled={disabled}
                renderAvatar={renderAvatar}
              />
            );
          })}
        </div>
      )}
    </span>
  );
}

// 内联的 UserName（使用 resolveUserName prop 而非 hook）
function OwnerNameInline({ uid, resolveName }: { uid: string; resolveName: (uid: string, fallback?: string) => string }) {
  return <>{resolveName(uid)}</>;
}
