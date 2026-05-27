import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import * as api from '../api/todoApi';
import type { Matter, MatterListParams, MatterStatus } from '../bridge/types';
import { Toast } from '../utils/toast';
import { t } from '@octo/base';

export interface UseMatterListOptions {
  initialFilters?: MatterListParams;
  pageSize?: number;
}

export interface UseMatterListResult {
  matters: Matter[];
  loading: boolean;
  hasMore: boolean;
  filters: MatterListParams;
  setFilters: (patch: Partial<MatterListParams>) => void;
  reload: () => void;
  loadMore: () => void;
  toggleStatus: (matterId: string, currentStatus: MatterStatus) => Promise<void>;
  optimisticUpdate: (matterId: string, patch: Partial<Matter>) => void;
  addOptimistic: (matter: Matter) => void;
  removeOptimistic: (matterId: string) => void;
}

export function useMatterList({
  initialFilters = {},
  pageSize = 50,
}: UseMatterListOptions = {}): UseMatterListResult {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFiltersState] = useState<MatterListParams>(initialFilters);
  const cursorRef = useRef<string | undefined>();
  // 追踪最新的 abort controller, 新请求发起前先 abort 旧请求, cleanup 时也 abort。
  // 作用:
  //   1. StrictMode 双 mount 下, 第二次 effect 把第一次的请求直接 cancel, 避免白费带宽
  //   2. 切换 channel / filter 时, 旧请求返回晚于新请求不会污染 state (竞态保护)
  const abortCtrlRef = useRef<AbortController | null>(null);

  // 当 initialFilters 引用变化时（如 channel 切换）同步重置 filters
  const initialFiltersKey = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  useEffect(() => {
    setFiltersState(initialFilters);
    cursorRef.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiltersKey]);

  // Stable string for useCallback deps — avoids recreating `load` on every render
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async (append = false, silent = false) => {
    // 发起新请求前 abort 掉上一次, 避免并发污染和 StrictMode 双发
    abortCtrlRef.current?.abort();
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    // silent 模式: 后台刷新 (如 matter-updated 广播触发), 不显示 loading,
    // 避免列表刷新时闪一下 "加载中" 破坏阅读体验。只在首次/过滤器变更时
    // 显示 loading。
    if (!append && !silent) setLoading(true);
    try {
      const params: MatterListParams = { ...filters, limit: pageSize };
      if (append && cursorRef.current) params.cursor = cursorRef.current;

      const res = await api.listMatters(params, ctrl.signal);
      // 若当前 controller 已被后续请求替换, 丢弃过期结果
      if (ctrl.signal.aborted) return;
      setMatters(append ? (prev) => [...prev, ...res.data] : res.data);
      setHasMore(res.pagination.has_more);
      cursorRef.current = res.pagination.next_cursor;
    } catch (err: unknown) {
      // AbortError 是主动取消, 不报错; 其余才提示用户
      if ((err as Error)?.name === 'AbortError') return;
      Toast.error(t('todo.toast.loadFailed'));
    } finally {
      // 当前请求若未被 abort, 才关掉 loading (被 abort 时新请求会重新 setLoading(true))
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [filtersKey, pageSize]);

  useEffect(() => {
    cursorRef.current = undefined;
    load(false);
    // cleanup: 组件卸载或 load 变化时 abort 在飞请求
    return () => {
      abortCtrlRef.current?.abort();
    };
  }, [load]);

  const setFilters = useCallback((patch: Partial<MatterListParams>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reload = useCallback(() => {
    cursorRef.current = undefined;
    // silent 模式: 事件驱动的后台刷新, 不触发 loading 态, 避免列表闪烁
    load(false, true);
  }, [load]);

  const loadMore = useCallback(() => {
    load(true);
  }, [load]);

  const toggleStatus = useCallback(async (matterId: string, currentStatus: MatterStatus) => {
    if (currentStatus === 'archived') return; // archived cannot be toggled directly
    const newStatus: MatterStatus = currentStatus === 'open' ? 'done' : 'open';
    try {
      await api.transitionMatter(matterId, newStatus);
      setMatters((prev) =>
        prev.map((t) => (t.id === matterId ? { ...t, status: newStatus } : t))
      );
    } catch {
      Toast.error(t('todo.toast.statusUpdateFailed'));
    }
  }, []);

  const optimisticUpdate = useCallback((matterId: string, patch: Partial<Matter>) => {
    setMatters((prev) => prev.map((t) => (t.id === matterId ? { ...t, ...patch } : t)));
  }, []);

  const addOptimistic = useCallback((matter: Matter) => {
    setMatters((prev) => [matter, ...prev]);
  }, []);

  /** 移除乐观条目：精确匹配 id，或前缀匹配（传入前缀字符串） */
  const removeOptimistic = useCallback((matterIdOrPrefix: string) => {
    setMatters((prev) => prev.filter((t) => !t.id.startsWith(matterIdOrPrefix) && t.id !== matterIdOrPrefix));
  }, []);

  return { matters, loading, hasMore, filters, setFilters, reload, loadMore, toggleStatus, optimisticUpdate, addOptimistic, removeOptimistic };
}
