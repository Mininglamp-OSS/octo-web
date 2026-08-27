import { WKApp } from '@octo/base';
import * as api from '../api/summaryApi';

/**
 * 侧边栏「智能总结」菜单的待关注红点计数 (#1359；口径扩展见下)。
 *
 * 独立成文件的原因与 chatSummaryActions 相同：module.tsx 引入
 * react-dom/client，单测不便直接 import。
 *
 * 数据源：优先走窄端点 GET /summaries/attention（只返回四个计数，服务端带 5s
 * 缓存）；该端点尚未部署时自动兜底回 GET /summaries?page_size=1 读同一个
 * `attention_count` 字段（均 space-scoped via X-Space-Id header，口径一致；
 * 具体见 api/summaryApi.ts 的 fetchSummaryAttentionCounts）。
 * 之所以值得新增一个窄端点：红点现在多了一条无人值守的定时兜底轮询
 * （utils/summaryAttentionPoll.ts），拿整页列表换三个整数的浪费会被频次放大。
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
// 只有“自己发出后再没人发过新读取”的响应才能落盘。现在有【三个】并发写者
// 共用同一个号段：全局列表 loadData、用户动作触发的探测，以及后台兜底轮询
// （utils/summaryAttentionPoll.ts）。轮询那个写者特别值得提：它是唯一一个在
// 【没有任何用户动作】时也会开火的，所以“轮询先发、用户随后打开列表、
// 轮询的旧响应最后到达”这类交错不需要用户配合就会发生。不排序的话，
// 先发后到的旧快照会盖掉新值。
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
    try {
        // 用户动作触发的刷新：带 fresh=1 绕过服务端 5s 缓存。用户刚做完一件事，
        // 看到的数字必须是他那次动作之后的。
        await readSummaryAttentionCount({ fresh: true });
    } catch {
        // 静默失败，保持旧值。readSummaryAttentionCount 内部已经还过号。
    }
}

/**
 * 读一次待关注计数，按 ticket 规则落盘，并把落盘用的值返回给调用方。
 *
 * 返回值的三态是给【兜底轮询】用的（utils/summaryAttentionPoll.ts 要靠
 * 「这次的值跟上次比变没变」来决定退避档位），三种情况必须能区分开：
 *   - number  → 成功取到一个当前 Space 的计数（不论是否真的写进了红点：
 *               被更新的读取顶掉时值本身仍然是新鲜的，可以参与比较）；
 *   - null    → 【这次没有可用样本】。前置条件不满足（未登录 / Space 未就绪），
 *               或请求飞行期间用户切了 Space。它不是失败，也不是「值没变」，
 *               调用方两边都不该记账：算失败会让切 Space 平白触发一次退避，
 *               算未变化则会把一次跨 Space 早退伪装成一段安静期。
 *   - throw   → 真的失败了（网络 / 5xx）。调用方据此退避。
 *
 * 号的领/交/还全在这里完成。定时轮询是号段的【第三个】并发写者（另两个是
 * SummaryListPage.loadData 与本函数自身的用户动作调用），而且是唯一一个
 * 没有用户动作也会开火的写者——把领号留给调用方，等于把最容易错的一步
 * 复制三份。所有早退路径都必须还号，否则号段停在一个再也不会提交的号上，
 * 一个发出更早、仍在飞、携带正确值的读取会被一并作废（ticket liveness）。
 */
export async function readSummaryAttentionCount(options?: { fresh?: boolean }): Promise<number | null> {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!WKApp.loginInfo.isLogined() || !WKApp.loginInfo.uid || !spaceId) return null;

    const ticket = beginSummaryAttentionRead();
    let counts: api.SummaryAttentionCounts;
    try {
        counts = await api.fetchSummaryAttentionCounts(options);
    } catch (err) {
        // 号还回去：失败的读取不该作废一个仍在飞、携带正确值的更早读取
        // （ticket liveness）。抛出去让轮询知道该退避；用户动作路径在外层吞掉。
        abandonSummaryAttentionRead(ticket);
        throw err;
    }
    if (WKApp.shared.currentSpaceId !== spaceId) {
        // 跨 Space 早退：本次读取作废，把号还回去，别把仍在飞的
        // 更早读取一并卡死（ticket liveness）。
        abandonSummaryAttentionRead(ticket);
        return null;
    }
    const count = counts?.attention_count ?? 0;
    commitSummaryAttentionBadge(ticket, count);
    return count;
}
