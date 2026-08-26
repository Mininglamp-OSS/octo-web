import { WKApp } from '@octo/base';
import * as api from '../api/summaryApi';

/**
 * 侧边栏「智能总结」菜单的待关注红点计数 (#1359；口径扩展见下)。
 *
 * 独立成文件的原因与 chatSummaryActions 相同：module.tsx 引入
 * react-dom/client，单测不便直接 import。
 *
 * 数据源：后端 GET /summaries 已返回全量 `attention_count`
 * (octo-smart-summary task.go，space-scoped via X-Space-Id header)，
 * 无需新增后端接口。用 page_size=1 拉取，只为拿 count 字段。
 *
 * ⚠️ 口径：#1359 首版只读 `pending_invitation_count`（仅未处理邀请），
 * 导致侧边栏数字与卡片红点（`needs_attention`）不一致——用户会看到
 * 「侧边栏显示 1 条，进去却有 3 个红点」。现在统一改读 `attention_count`，
 * 与后端 needs_attention 同源：未读结果 ∪ 未处理邀请 ∪ 待提交个人总结。
 *
 * 渲染链路：`Menus.badge?: number` 字段与 NavRail/NavItem 的 badge
 * 渲染（wk-navrail__badge CSS）均已存在但从未被赋值——module.tsx 的
 * 菜单 factory 每次 render 都会重新读 getSummaryAttentionBadge()，
 * setSummaryAttentionBadge 触发 WKApp.menus.refresh()（宿主 Main
 * 已接线 setRefresh → forceUpdate），NavRail 即重绘。
 */
let summaryAttentionBadge = 0;
let refreshSeq = 0;
// 在飞请求按 Space 缓存。只合并同一 Space 的并发拉取；跨 Space 绝不复用，
// 否则切空间后的调用会拿到上一个 Space 的计数。
let inFlight: { spaceId: string; promise: Promise<void> } | null = null;

export function getSummaryAttentionBadge(): number {
    return summaryAttentionBadge;
}

/**
 * 更新计数并刷新 NavRail。相同值不重复触发，避免宿主 forceUpdate
 * 风暴（docs/module.tsx 注释：宿主 re-render 是高频 sync priority）。
 *
 * 写入同时作废掉在飞的 refresh（共用 refreshSeq）：全局列表的响应携带完整
 * 分页数据，至少与并发的 page_size=1 探测同鲜。不共用序号的话，两个写者
 * 只是“碰巧现在返回同一个数”，而不是真的有序。
 */
export function setSummaryAttentionBadge(count: number): void {
    refreshSeq++;
    const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    if (next === summaryAttentionBadge) return;
    summaryAttentionBadge = next;
    WKApp.menus.refresh();
}

/**
 * 拉取当前 space 的待关注数并更新红点。
 * 失败静默：红点是锦上添花，网络异常不应打扰用户（与 SummaryListPage
 * silent refresh 同样的克制原则）。
 *
 * 同 Space 并发合并：一次变更常常同时触发多个入口（如提交后既发
 * summary-task-regenerated 让列表重拉、又直接调本函数兼顾列表未挂载的
 * 情况），共用同一个在飞请求，避免发出两个等价的 page_size=1 查询。
 */
export async function refreshSummaryAttentionBadge(): Promise<void> {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!WKApp.loginInfo.isLogined() || !WKApp.loginInfo.uid || !spaceId) return;
    if (inFlight && inFlight.spaceId === spaceId) return inFlight.promise;

    const seq = ++refreshSeq;
    const promise = (async () => {
        try {
            const resp = await api.listSummaries({ page: 1, page_size: 1 });
            if (seq !== refreshSeq || WKApp.shared.currentSpaceId !== spaceId) return;
            setSummaryAttentionBadge(resp.attention_count ?? 0);
        } catch {
            // 静默失败，保持旧值。
        } finally {
            if (inFlight?.promise === promise) inFlight = null;
        }
    })();
    inFlight = { spaceId, promise };
    return promise;
}
