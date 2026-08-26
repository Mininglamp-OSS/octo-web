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

export function getSummaryAttentionBadge(): number {
    return summaryAttentionBadge;
}

/**
 * 更新计数并刷新 NavRail。相同值不重复触发，避免宿主 forceUpdate
 * 风暴（docs/module.tsx 注释：宿主 re-render 是高频 sync priority）。
 */
export function setSummaryAttentionBadge(count: number): void {
    const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    if (next === summaryAttentionBadge) return;
    summaryAttentionBadge = next;
    WKApp.menus.refresh();
}

/**
 * 拉取当前 space 的待关注数并更新红点。
 * 失败静默：红点是锦上添花，网络异常不应打扰用户（与 SummaryListPage
 * silent refresh 同样的克制原则）。
 */
export async function refreshSummaryAttentionBadge(): Promise<void> {
    const seq = ++refreshSeq;
    const spaceId = WKApp.shared.currentSpaceId;
    if (!WKApp.loginInfo.isLogined() || !WKApp.loginInfo.uid || !spaceId) return;

    try {
        const resp = await api.listSummaries({ page: 1, page_size: 1 });
        if (seq !== refreshSeq || WKApp.shared.currentSpaceId !== spaceId) return;
        setSummaryAttentionBadge(resp.attention_count ?? 0);
    } catch {
        // 静默失败，保持旧值。
    }
}
