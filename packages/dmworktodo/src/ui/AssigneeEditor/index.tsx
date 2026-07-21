import React, { useState, useCallback, useEffect, useRef, useMemo, useReducer } from 'react';
import { WKApp, isSafeUrl, resolveExternalForViewer, addImChannelInfoListener, fetchImChannelInfo, getImChannelInfo } from '@octo/base';
import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson } from 'wukongimjssdk';
import type { MatterAssignee } from '../../bridge/types';
import { useUserName } from '../../hooks/useUserName';
import * as api from '../../api/todoApi';
import { Toast } from '../../utils/toast';
import './index.css';

// ─── Single Assignee Chip ────────────────────────────────

function AssigneeChip({ assignee, matterId, editable, onRemoved }: {
  assignee: MatterAssignee;
  matterId: string;
  editable: boolean;
  onRemoved: () => void;
}) {
  const name = useUserName(assignee.user_id);
  const [removing, setRemoving] = useState(false);

  const handleRemove = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (removing) return;
    setRemoving(true);
    try {
      await api.removeAssignee(matterId, assignee.user_id);
      onRemoved();
    } catch (err) {
      Toast.error('Failed to remove assignee');
      setRemoving(false);
    }
  }, [matterId, assignee.user_id, removing, onRemoved]);

  return (
    <span className="wk-assignee-chip">
      <span className="wk-assignee-chip__name">{name}</span>
      {editable && (
        <button
          type="button"
          className="wk-assignee-chip__remove"
          onClick={handleRemove}
          disabled={removing}
          title="Remove assignee"
        >
          ✕
        </button>
      )}
    </span>
  );
}

// ─── Search Result Item ──────────────────────────────────

interface SearchResult {
  uid: string;
  name: string;
  avatar: string;
  /**
   * 候选人相对当前查看 Space 的来源 Space 名称。非空时在姓名后
   * 追加「@{sourceSpaceName}」后缀，避免跨 Space 分派 Matter 时误选外部成员。
   */
  sourceSpaceName?: string;
}

function SearchResultItem({ result, onSelect }: { result: SearchResult; onSelect: (uid: string) => void }) {
  return (
    <div
      className="wk-assignee-search__item"
      onClick={() => onSelect(result.uid)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(result.uid); }}
    >
      {result.avatar && isSafeUrl(result.avatar) && (
        <img src={result.avatar} alt="" className="wk-assignee-search__avatar" />
      )}
      <span className="wk-assignee-search__name">{result.name}</span>
      {/* 外部候选的「@SpaceName」后缀，与 @Mention 候选、成员列表视觉一致 */}
      {result.sourceSpaceName && (
        <span
          className="wk-assignee-search__space"
          title={`@${result.sourceSpaceName}`}
        >
          @{result.sourceSpaceName}
        </span>
      )}
    </div>
  );
}

// ─── Assignee Editor ─────────────────────────────────────

export interface AssigneeEditorProps {
  matterId: string;
  assignees: MatterAssignee[];
  onChanged: () => void;
}

export default function AssigneeEditor({ matterId, assignees, onChanged }: AssigneeEditorProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // 订阅 channelInfo 更新。下方 useEffect 触发的
  // fetchChannelInfo 是异步的，返回前 results 里的 sourceSpaceName 还是 ''；
  // 没有 listener 时 fetch 完成 UI 不会重算，外部后缀始终空 = silent failure。
  // 拿到任意 Person channelInfo 就 bump tick，让 useMemo 重跑命中本地缓存。
  const [tick, bumpTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const listener: ChannelInfoListener = (channelInfo: ChannelInfo) => {
      if (channelInfo?.channel?.channelType === ChannelTypePerson) {
        bumpTick();
      }
    };
    return addImChannelInfoListener(WKSDK.shared(), listener);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showSearch) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearch]);

  // Filter contacts from local cache — no network request.
  // round 3 (CR lml2468 #1088:165-168): useMemo 必须保持纯计算，
  // fetchChannelInfo 副作用移到下面的 useEffect。cache miss 时本次渲染
  // sourceSpaceName 保持 ''，fetch 成功后由 channelManager listener bumpTick
  // 触发重算命中本地缓存；fetch 失败在 useEffect 里 console.warn 暴露，
  // 而不是原来裸调 Promise → reject 静默 fall-through 成「同 Space」(fail-open)。
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    const assignedUids = new Set(assignees.map(a => a.user_id));
    const keyword = query.trim().toLowerCase();
    const contacts = WKApp.dataSource?.contactsList ?? [];
    return contacts
      .filter((c) =>
        !assignedUids.has(c.uid) &&
        (c.name?.toLowerCase().includes(keyword) || c.uid.toLowerCase().includes(keyword))
      )
      .slice(0, 8)
      .map((c) => {
        // 跨 Space 分派 Matter 时，在候选姓名后显示外部成员的来源 Space。
        // Contacts 本身不携带 home_space_* 字段，从 channelInfo.orgData 读取；
        // cache miss 由下面的 useEffect 异步 fetch，下次 tick 时命中本地缓存。
        let sourceSpaceName = '';
        try {
          const ch = new Channel(c.uid, ChannelTypePerson);
          const ci = getImChannelInfo(WKSDK.shared(), ch);
          const org = ci?.orgData;
          if (org) {
            const ext = resolveExternalForViewer({
              homeSpaceId: org.home_space_id as string | undefined,
              homeSpaceName: org.home_space_name as string | undefined,
              isExternalLegacy: org.is_external as number | undefined,
              sourceSpaceNameLegacy: org.source_space_name as string | undefined,
            });
            if (ext.isExternal) sourceSpaceName = ext.sourceSpaceName;
          }
          // else: cache miss — 不在这里触发 fetch（见下面的 useEffect）
        } catch (err) {
          // 单个候选信息读取失败不阻断列表渲染，但不静默吞掉异常（CR: #1088 Jerry-Xin #3）
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[AssigneeEditor] resolve sourceSpaceName failed for', c.uid, err);
          }
        }
        return {
          uid: c.uid,
          name: c.name || c.uid,
          avatar: c.avatar || '',
          sourceSpaceName,
        };
      });
    // tick 加入依赖：channelInfo 到达后重算 sourceSpaceName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, assignees, tick]);

  // round 3 (CR lml2468 #1088:165-168): fetch cache-miss channelInfo
  // 作为 side effect 独立出来。关键点：
  //   1. 原 useMemo 里 `fetchChannelInfo(ch)` 是裸 Promise，try/catch 只能捕到
  //      同步异常，Promise reject 被吞，渲染继续 sourceSpaceName=''，外部候选
  //      被当成同 Space → fail-open 破坏跨 Space 保护。
  //   2. 每个 fetch 用 .catch 单独兜底（语义等价 Promise.allSettled，但本包
  //      tsconfig target=es2019 没有 allSettled 类型，手写更稳），再 Promise.all
  //      汇总，reject 不再静默。
  //   3. AbortController 防止 unmount / query 变化后 race-condition 的 setState。
  useEffect(() => {
    if (!query.trim()) return;
    const assignedUids = new Set(assignees.map(a => a.user_id));
    const keyword = query.trim().toLowerCase();
    const contacts = WKApp.dataSource?.contactsList ?? [];
    const candidates = contacts
      .filter((c) =>
        !assignedUids.has(c.uid) &&
        (c.name?.toLowerCase().includes(keyword) || c.uid.toLowerCase().includes(keyword))
      )
      .slice(0, 8);

    const missing: Channel[] = [];
    for (const c of candidates) {
      const ch = new Channel(c.uid, ChannelTypePerson);
      const ci = getImChannelInfo(WKSDK.shared(), ch);
      if (!ci?.orgData) missing.push(ch);
    }
    if (missing.length === 0) return;

    type FetchOutcome = { ok: true } | { ok: false; reason: unknown };
    const abortController = new AbortController();
    Promise.all(
      missing.map((ch): Promise<FetchOutcome> =>
        fetchImChannelInfo(WKSDK.shared(), ch)
          .then((): FetchOutcome => ({ ok: true }))
          .catch((reason: unknown): FetchOutcome => ({ ok: false, reason }))
      )
    ).then((settled) => {
      if (abortController.signal.aborted) return;
      const failed = settled.filter((r): r is { ok: false; reason: unknown } => !r.ok);
      if (failed.length > 0) {
        // 可见性：本次 CR 要求 reject 不静默。prod 也 warn（量很小，只在候选
        // 下拉打开且 cache miss 时触发，且 WKSDK 对同一 channel 自带去重）。
        console.warn(
          '[AssigneeEditor] fetchChannelInfo failed for',
          failed.length,
          'candidate channel(s); sourceSpaceName for these candidates will remain empty',
          failed.map((f) => f.reason)
        );
      }
      // 成功分支理论上由 channelManager listener bumpTick 已触发，但此处兜底
      // 再 bump 一次，防止 HMR / listener 未挂等边缘情况下 UI 不刷新。只做一次，
      // 不会死循环（本 useEffect 不依赖 tick，bumpTick 不会重触发 fetch）。
      bumpTick();
    });
    return () => abortController.abort();
  }, [query, assignees]);

  const handleSelect = useCallback(async (uid: string) => {
    if (adding) return;
    setAdding(true);
    try {
      await api.addAssignee(matterId, uid);
      setShowSearch(false);
      setQuery('');
      onChanged();
    } catch (err) {
      Toast.error('Failed to add assignee');
    } finally {
      setAdding(false);
    }
  }, [matterId, adding, onChanged]);

  return (
    <div className="wk-assignee-editor">
      <div className="wk-assignee-editor__label">
        <strong>Assignees</strong>
      </div>
      <div className="wk-assignee-editor__chips">
        {assignees.length === 0 && !showSearch && (
          <span className="wk-assignee-editor__empty">No assignees</span>
        )}
        {assignees.map((a) => (
          <AssigneeChip
            key={a.id}
            assignee={a}
            matterId={matterId}
            editable={true}
            onRemoved={onChanged}
          />
        ))}
        {!showSearch && (
          <button
            type="button"
            className="wk-assignee-editor__add-btn"
            onClick={() => setShowSearch(true)}
            title="Add assignee"
          >
            +
          </button>
        )}
      </div>
      {showSearch && (
        <div className="wk-assignee-search" ref={searchRef}>
          <input
            type="text"
            className="wk-assignee-search__input"
            placeholder="Search by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowSearch(false); setQuery(''); }
            }}
            autoFocus
          />
          {query.trim() && (
            <div className="wk-assignee-search__dropdown">
              {results.length === 0 && (
                <div className="wk-assignee-search__empty">No results</div>
              )}
              {results.map((r) => (
                <SearchResultItem key={r.uid} result={r} onSelect={handleSelect} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
