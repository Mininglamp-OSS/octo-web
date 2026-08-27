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
// 计数读取的单调取号。写入按【请求发出时刻】排序，而不是按响应到达顺序：
// 只有“自己发出后再没人发过新读取”的响应才能落盘。两个写者（全局列表
// loadData 与 page_size=1 探测）共用同一个号段，否则先发后到的旧快照会盖
// 掉新值。
let issueSeq = 0;

export function getSummaryAttentionBadge(): number {
    return summaryAttentionBadge;
}

/**
 * 领取一个读取号。必须在发起请求【之前】调用，因为号码代表的是
 * “这份数据是什么时候向服务端要的”。在 await 之后才取号等于把到达顺序
 * 当成发出顺序，正是本机制要避开的错。
 */
export function beginSummaryAttentionRead(): number {
    return ++issueSeq;
}

/**
 * 用领号时拿到的 ticket 提交一个读取结果。期间若有更新的读取被发出，
 * 本次结果就是陈旧快照，丢弃。注意「丢弃后由更新的读取带回正确值」只
 * 在那个更新的读取【成功】时成立：它若失败或被放弃，号段就停在它那里，
 * 仍在飞的更早读取（哪怕带着正确值）会被一并作废。所以失败/放弃路径
 * 必须调 abandonSummaryAttentionRead 把号还回去（ticket liveness）。
 * 若它失败，按“静默失败保持旧值”的一贯策略，宁可不刷也不写旧数。
 */
export function commitSummaryAttentionBadge(ticket: number, count: number): void {
    if (ticket !== issueSeq) return;
    setSummaryAttentionBadge(count);
}

/**
 * 放弃一个已领取、确定不会再提交的读取号（请求失败 / 跨 Space 早退 /
 * 卸载或 seq 早退）。
 *
 * 只在号仍是最新时归还（`issueSeq--`）：归还后，仍在飞的更早读取的票
 * 号重新成为最新，它带回的正确值得以落盘——堵掉「新读取失败/放弃却
 * 把旧的正确响应作废」的死角。若已有更新的读取发出
 * （号不再是自己的），不动：那个更新的读取自己负责成功或放弃。
 *
 * ⚠️ 绝不能在成功 commit 之后调用：那会把已消费的号还回去，平白给更
 * 早的陈旧快照开一扇后门。调用方用 committed 标志守住（见
 * SummaryListPage.loadData 的 finally）。
 */
export function abandonSummaryAttentionRead(ticket: number): void {
    if (ticket === issueSeq) issueSeq--;
}

/**
 * 直接设值（不参与排序）。相同值不重复触发，避免宿主 forceUpdate
 * 风暴（docs/module.tsx 注释：宿主 re-render 是高频 sync priority）。
 *
 * ⚠️ 它【不】推进 issueSeq。曾经推过，目的是让列表写入作废在飞探测，
 * 但那是按到达顺序作废：一个发出更早、携带更旧快照的 loadData 响应（甚至
 * 是值没变的 no-op 写入）会把刚发出的正确探测杀掉，红点卡在陈值。
 * 现在排序一律走 beginSummaryAttentionRead / commitSummaryAttentionBadge。
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
 *
 * ⚠️ 每次调用都真的发一个请求，【不】合并并发。曾经按同 Space 合并过，
 * 为的是省一个 page_size=1 的 GET，但那是错的：后来者的变更可能在在飞请求
 * 发出【之后】才提交，复用它就是拿一份早于自己变更的快照。最常见的路径
 * 就会撞上：打开一条 BY_PERSON 总结会发两次 markSummaryRead（loadDetail 一次，
 * 它调的 loadPersonalResult 再一次），而后端 unread = 团队未读 【OR】个人未读，
 * 第一次读根本清不掉计数——合并后第二次刷新直接被吞，红点全没了导航栏却
 * 还显示着数字。省一个轻量 GET 不值这个代价。
 */
export async function refreshSummaryAttentionBadge(): Promise<void> {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!WKApp.loginInfo.isLogined() || !WKApp.loginInfo.uid || !spaceId) return;

    const ticket = beginSummaryAttentionRead();
    try {
        const resp = await api.listSummaries({ page: 1, page_size: 1 });
        if (WKApp.shared.currentSpaceId !== spaceId) {
            // 跨 Space 早退：本次读取作废，把号还回去，别把仍在飞的
            // 更早读取一并卡死（ticket liveness）。
            abandonSummaryAttentionRead(ticket);
            return;
        }
        commitSummaryAttentionBadge(ticket, resp.attention_count ?? 0);
    } catch {
        // 静默失败，保持旧值。号也还回去：失败的读取不该作废一个
        // 仍在飞、携带正确值的更早读取（ticket liveness）。
        abandonSummaryAttentionRead(ticket);
    }
}
