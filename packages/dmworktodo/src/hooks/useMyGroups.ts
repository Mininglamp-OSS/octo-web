import { useEffect, useRef, useState } from 'react';
import { WKApp } from '@octo/base';

/**
 * useMyGroups — 拉取当前用户在当前 Space 下加入的所有群, 返回 group_no 集合。
 *
 * 接口: GET /api/v1/group/my?space_id={spaceId}
 * 响应: Array<{ group_no: string; name: string; ... }>
 *
 * 用于判断 Matter 关联群聊里哪些是 "我没加入的群", 从而:
 *   1. 把未加入群的名字模糊展示
 *   2. 不给未加入群的时间线条目展示 "↗ 原消息" 按钮 (权限不允许查原消息)
 *
 * 缓存策略:
 *   - 组件级缓存, 每次 hook 挂载拉一次, unmount 清理
 *   - spaceId 变化时自动重拉
 *   - 失败返回空 Set, 调用方把所有群当成 "未加入" — 这是安全保守的降级
 *     (UI 会全部模糊, 宁可多遮不要少遮, 避免把不该看到的群名暴露)
 */
interface MyGroupRaw {
    group_no: string;
    name?: string;
    [k: string]: unknown;
}

interface UseMyGroupsResult {
    groupNos: Set<string>;
    loading: boolean;
    /** 拉取失败时为 true, 调用方可以据此做 "无法判断权限" 的保守处理 */
    failed: boolean;
}

export function useMyGroups(): UseMyGroupsResult {
    const [groupNos, setGroupNos] = useState<Set<string>>(() => new Set());
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [spaceId, setSpaceId] = useState(() => WKApp.shared.currentSpaceId || '');
    // requestId 保护: spaceId 快速切换时丢弃过期响应
    const reqIdRef = useRef(0);

    // 监听 space-changed 事件, 切换 Space 时重新拉取群列表
    useEffect(() => {
        const onSpaceChanged = () => {
            setSpaceId(WKApp.shared.currentSpaceId || '');
        };
        WKApp.mittBus.on('space-changed', onSpaceChanged);
        return () => {
            WKApp.mittBus.off('space-changed', onSpaceChanged);
        };
    }, []);

    useEffect(() => {
        if (!spaceId) {
            setGroupNos(new Set());
            setLoading(false);
            setFailed(false);
            return;
        }
        const reqId = ++reqIdRef.current;
        setLoading(true);
        setFailed(false);
        // 切换时先清空旧数据, 保守处理 (宁可多遮)
        setGroupNos(new Set());
        WKApp.apiClient
            .get('group/my', { param: { space_id: spaceId } })
            .then((resp: MyGroupRaw[] | undefined) => {
                if (reqId !== reqIdRef.current) return;
                const next = new Set<string>();
                if (Array.isArray(resp)) {
                    for (const g of resp) {
                        if (g && typeof g.group_no === 'string') {
                            next.add(g.group_no);
                        }
                    }
                }
                setGroupNos(next);
                setLoading(false);
            })
            .catch((err: unknown) => {
                if (reqId !== reqIdRef.current) return;
                console.warn('[useMyGroups] fetch failed', err);
                setGroupNos(new Set());
                setLoading(false);
                setFailed(true);
            });

        return () => { reqIdRef.current++; };
    }, [spaceId]);

    return { groupNos, loading, failed };
}
