import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { WKApp, useI18n } from '@octo/base';
import AiBadge from '@octo/base/src/Components/AiBadge';
import type { MatterAssignee } from '../../bridge/types';
import { useMemberList, AssigneeInfo } from '../../hooks/useMemberList';
import * as api from '../../api/todoApi';
import { Toast } from '../../utils/toast';
import { useUserName } from '../../hooks/useUserName';
import './index.css';

// ─── Props 接口 ──────────────────────────────────────────

interface MemberPickerControlledProps {
  mode: 'controlled';
  value: string[];
  onChange: (uids: string[]) => void;
  channel?: { channelId: string; channelType: number };
  placeholder?: string;
  disabled?: boolean;
}

interface MemberPickerDirectProps {
  mode: 'direct';
  matterId: string;
  assignees: MatterAssignee[];
  onChanged?: (addedUid?: string, removedUid?: string) => void;
  channel?: { channelId: string; channelType: number };
  placeholder?: string;
  disabled?: boolean;
}

export type MemberPickerProps = MemberPickerControlledProps | MemberPickerDirectProps;

// ─── Tag 组件 ────────────────────────────────────────────

function MemberTag({
  uid,
  onRemove,
  disabled,
}: {
  uid: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const name = useUserName(uid);
  const avatarUrl = WKApp.shared.avatarUser(uid);
  const initial = (name || uid).charAt(0).toUpperCase();
  const bgColor = `hsl(${(uid?.charCodeAt(0) ?? 65) * 5 % 360}, 60%, 55%)`;

  return (
    <span className="wk-member-picker__tag">
      <span style={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'inline-flex' }}>
        <img
          src={avatarUrl}
          alt=""
          style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span style={{
          width: 16, height: 16, borderRadius: '50%', background: bgColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '9px', fontWeight: 700, color: '#fff',
        }}>{initial}</span>
      </span>
      <span className="wk-member-picker__tag-name">{name}</span>
      {!disabled && (
        <button
          type="button"
          className="wk-member-picker__tag-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t("todo.action.remove")}
        >
          ✕
        </button>
      )}
    </span>
  );
}

// ─── 成员选项组件 ────────────────────────────────────────

function MemberOption({
  member,
  isSelected,
  onClick,
}: {
  member: AssigneeInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`wk-member-picker__option ${isSelected ? 'wk-member-picker__option--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation(); // 防止冒泡触发 Modal 的 Enter 确认
          onClick();
        }
      }}
    >
      <div className="wk-member-picker__option-avatar">
        <img
          src={member.avatar || ''}
          alt=""
          style={{ display: member.avatar ? undefined : 'none' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        {!member.avatar && (
          <div className="wk-member-picker__option-avatar-placeholder" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: 600, color: '#fff',
            background: `hsl(${(member.name?.charCodeAt(0) ?? 65) * 5 % 360}, 60%, 55%)`,
          }}>
            {(member.name || member.uid).charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="wk-member-picker__option-info">
        <span className="wk-member-picker__option-name">{member.name}</span>
        {member.isBot && <AiBadge size="small" />}
      </div>
    </div>
  );
}

// ─── MemberPicker 主组件 ─────────────────────────────────

export default function MemberPicker(props: MemberPickerProps) {
  const { t } = useI18n();
  const { channel, placeholder = t("todo.member.searchPlaceholder"), disabled = false } = props;

    // 受控模式 vs 直连模式，用两个独立变量避免条件表达式作依赖
  const controlledValue = props.mode === 'controlled' ? props.value : undefined;
  const directAssignees = props.mode === 'direct' ? props.assignees : undefined;
  const selectedUids = useMemo(() => {
    if (props.mode === 'controlled') {
      return controlledValue ?? [];
    } else {
      return directAssignees?.map((a) => a.user_id) ?? [];
    }
  }, [props.mode, controlledValue, directAssignees]);

  const [showDropdown, setShowDropdown] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // 修复 click-outside 未覆盖 wrapper div 的问题
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout>();

  // 获取成员列表
  const { members, loading } = useMemberList({
    channel,
    keyword: debouncedKeyword,
    enabled: showDropdown,
  });

  // members 直接用 members，无需 useMemo 包装

  // 搜索防抖 300ms
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedKeyword(inputValue.trim());
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!showDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      // 修复：检查整个 wrapper（含 tag 区域），而不只是 input 元素
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setInputValue('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  // 提取具体字段避免 [props] 导致每次渲染重建 callback
  const onChange = props.mode === 'controlled' ? props.onChange : undefined;
  const matterId = props.mode === 'direct' ? props.matterId : undefined;
  const onChanged = props.mode === 'direct' ? props.onChanged : undefined;

  // 受控模式更新
  const updateControlled = useCallback(
    (newUids: string[]) => {
      onChange?.(newUids);
    },
    [onChange]
  );

  // 直连模式更新
  const updateDirect = useCallback(
    async (uid: string, action: 'add' | 'remove') => {
      if (!matterId) return;
      try {
        if (action === 'add') {
          await api.addAssignee(matterId, uid);
          onChanged?.(uid, undefined);
        } else {
          await api.removeAssignee(matterId, uid);
          onChanged?.(undefined, uid);
        }
      } catch (error) {
        Toast.error(t("todo.member.updateFailed", { values: { action: action === 'add' ? t("todo.action.add") : t("todo.action.remove") } }));
      }
    },
    [matterId, onChanged, t]
  );

  // 添加成员
  const handleAddMember = useCallback(
    (uid: string) => {
      if (selectedUids.includes(uid)) return;

      if (props.mode === 'controlled') {
        updateControlled([...selectedUids, uid]);
      } else {
        updateDirect(uid, 'add');
      }

      // 选中后不关闭下拉，继续展示
      setInputValue('');
    },
    [selectedUids, props.mode, updateControlled, updateDirect]
  );

  // 移除成员
  const handleRemoveMember = useCallback(
    (uid: string) => {
      if (props.mode === 'controlled') {
        updateControlled(selectedUids.filter((id) => id !== uid));
      } else {
        updateDirect(uid, 'remove');
      }
    },
    [selectedUids, props.mode, updateControlled, updateDirect]
  );

  // 切换成员选中状态
  const handleToggleMember = useCallback(
    (uid: string) => {
      if (selectedUids.includes(uid)) {
        handleRemoveMember(uid);
      } else {
        handleAddMember(uid);
      }
    },
    [selectedUids, handleAddMember, handleRemoveMember]
  );

  // Backspace 删除最后一个 Tag
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && inputValue === '' && selectedUids.length > 0) {
        const lastUid = selectedUids[selectedUids.length - 1];
        handleRemoveMember(lastUid);
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
        setInputValue('');
      }
    },
    [inputValue, selectedUids, handleRemoveMember]
  );

  return (
    <div ref={wrapperRef} className={`wk-member-picker ${disabled ? 'wk-member-picker--disabled' : ''}`}>
      <div
        className={`wk-member-picker__input-wrapper ${showDropdown ? 'wk-member-picker__input-wrapper--focused' : ''}`}
        onClick={() => {
          if (!disabled) {
            setShowDropdown(true);
            inputRef.current?.focus();
          }
        }}
      >
        {/* 已选成员 Tags */}
        {selectedUids.map((uid) => (
          <MemberTag key={uid} uid={uid} onRemove={() => handleRemoveMember(uid)} disabled={disabled} />
        ))}

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          className="wk-member-picker__input"
          placeholder={selectedUids.length === 0 ? placeholder : ''}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>

      {/* 下拉菜单 */}
      {showDropdown && !disabled && (
        <div ref={dropdownRef} className="wk-member-picker__dropdown">
          {loading ? (
            <div className="wk-member-picker__loading">{t("todo.state.loading")}</div>
          ) : members.length === 0 ? (
            <div className="wk-member-picker__empty">
              {debouncedKeyword ? t("todo.member.noMatches") : t("todo.member.empty")}
            </div>
          ) : (
            members.map((member) => (
              <MemberOption
                key={member.uid}
                member={member}
                isSelected={selectedUids.includes(member.uid)}
                onClick={() => handleToggleMember(member.uid)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
