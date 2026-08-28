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
/**
 * 当前在飞的读取数量（领了号、还没 commit 也还没 abandon）。
 *
 * 只服务于【广播】的取舍：本标签页自己有读取在飞时，那个读取比任何广播都权威
 * （它反映的是本标签页用户刚做完的动作，且带 fresh=1），此时到达的广播一律不写。
 * 本地读取之间的排序仍然只靠票号，与这个计数无关。
 */
let inFlightReads = 0;
/**
 * 最近一次真正落盘的样本所反映的【服务端时刻】（见 attentionSampleAt）。
 *
 * 号段解决不了广播的排序：广播来自另一个标签页，它的票号属于那边的号段，
 * 两个号段之间没有任何可比性。而红点值本身是跨标签页共享的同一份事实，
 * 所以必须有一个跨标签页可比的刻度——同源标签页共用系统时钟，取数时刻就是。
 */
let lastCommittedSampleAt = 0;

/**
 * 服务端 attention 缓存的时长。与后端 `GET /summaries/attention` 的 5s 缓存
 * 一致（见 api/summaryApi.ts）。改后端缓存时这里必须跟着改。
 */
export const ATTENTION_CACHE_TTL_MS = 5_000;

/**
 * 把「请求发出时刻」折算成「这份数据所反映的服务端时刻」。
 *
 * 不带 fresh 的读可能命中服务端的 5s 缓存，那条缓存最早可能是 5 秒前建的，
 * 所以它代表的状态时刻要按【最坏情况】往前推一个 TTL。带 fresh 的读绕过缓存，
 * 发出时刻就是它反映的时刻。
 *
 * 折算不是吹毛求疵，它正是本机制要防的那条交错：leader 的轮询（不带 fresh）
 * 在用户动作【之后】发出，却可能取回动作【之前】的缓存值。只比发出时刻的话，
 * 这份陈旧快照反而更“新”，会把用户刚点掉的红点重新点亮——恰好复现本 PR 用
 * fresh=1 刻意规避的那个观感。
 */
export function attentionSampleAt(issuedAt: number, fresh: boolean): number {
    return fresh ? issuedAt : issuedAt - ATTENTION_CACHE_TTL_MS;
}

export function getSummaryAttentionBadge(): number {
    return summaryAttentionBadge;
}

/** 本标签页当前是否有读取在飞。广播接受判定用，另见 inFlightReads。 */
export function hasInFlightAttentionRead(): boolean {
    return inFlightReads > 0;
}

/**
 * 本标签页取数成功后向其它标签页广播的钩子（module.tsx 接到 leader.publish）。
 *
 * 放在这里而不是只给轮询接，是因为【每一次】成功的本地读取都值得广播，
 * 不只是 leader 的轮询：用户在一个标签页里点开总结、红点清掉，其它标签页的
 * 红点本来就该跟着灭，而不是等下一拍轮询（最长 60s）。而且用户动作的读带
 * fresh=1，样本时刻最新，天然能排赢任何在飞的缓存读。
 *
 * 广播只在这一处发出，不要再给轮询的 onCount 接一份：两处都发就是同一个
 * 样本广播两次（第二次因 sampleAt 相等而被对端丢弃，只是白跑一轮）。
 */
let attentionPublisher: ((count: number, sampleAt: number) => void) | null = null;

export function setSummaryAttentionPublisher(
    publisher: ((count: number, sampleAt: number) => void) | null,
): void {
    attentionPublisher = publisher;
}

/** 测试用：重置模块级的广播排序状态（模块级状态跨用例会串）。 */
export function resetSummaryAttentionOrdering(): void {
    inFlightReads = 0;
    lastCommittedSampleAt = 0;
    attentionPublisher = null;
}

/**
 * 领取一个读取号。必须在发起请求【之前】调用，因为号码代表的是
 * “这份数据是什么时候向服务端要的”。在 await 之后才取号等于把到达顺序
 * 当成发出顺序，正是本机制要避开的错。
 */
export function beginSummaryAttentionRead(): number {
    inFlightReads += 1;
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
export function commitSummaryAttentionBadge(ticket: number, count: number, sampleAt?: number): void {
    // 本地读取结束：无论是否落盘，它都不再在飞了。放在 seq 判定【之前】，
    // 被更新的读取顶掉的那次也必须销账，否则计数只增不减，广播被永久堵死。
    if (inFlightReads > 0) inFlightReads -= 1;
    if (ticket !== issueSeq) return;
    // 记下这次落盘所反映的服务端时刻，供广播排序比较。sampleAt 缺省时
    // （SummaryListPage.loadData 这类没有折算信息的调用方）按“现在”记：
    // 列表响应刚到，把它当成最新样本，之后到达的旧广播理应排不过它。
    lastCommittedSampleAt = sampleAt ?? Date.now();
    setSummaryAttentionBadge(count);
}

/**
 * 收下一条来自其它标签页的广播计数。
 *
 * 广播【不能】直接 setSummaryAttentionBadge：那是 last-write-wins，会出现
 * 「用户在本标签页点掉红点、本地已 commit 新值，leader 那条更早发出的响应
 * 随后到达并广播旧值，把刚清掉的红点又点回来」。这条交错不需要用户配合，
 * leader 的轮询本来就是无人值守自行开火的。
 *
 * 两道闸：
 *   1. 本地有读取在飞 → 一律不收。那个读取更权威（本标签页用户的动作、带
 *      fresh），它回来时会写正确值；此刻收广播只是徒增一次闪烁。
 *   2. 广播样本的服务端时刻不晚于本地最后一次落盘 → 丢弃。这是真正的排序。
 *
 * @returns 是否真的写入了（测试与诊断用）。
 */
export function acceptRemoteAttentionCount(count: number, sampleAt: number): boolean {
    if (!Number.isFinite(count) || !Number.isFinite(sampleAt)) return false;
    if (inFlightReads > 0) return false;
    if (sampleAt <= lastCommittedSampleAt) return false;
    lastCommittedSampleAt = sampleAt;
    setSummaryAttentionBadge(count);
    return true;
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
    // 同 commit：本地读取结束就销账，与号还不还得回去无关。
    if (inFlightReads > 0) inFlightReads -= 1;
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
export async function readSummaryAttentionCount(
    options?: { fresh?: boolean },
): Promise<{ count: number; sampleAt: number } | null> {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!WKApp.loginInfo.isLogined() || !WKApp.loginInfo.uid || !spaceId) return null;

    const fresh = options?.fresh === true;
    // 折算基准必须取【发出前】的时刻，和领号同一个道理：await 之后再取，
    // 记的就是到达时刻，正是本机制要避开的错。
    const sampleAt = attentionSampleAt(Date.now(), fresh);
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
    commitSummaryAttentionBadge(ticket, count, sampleAt);
    // 广播放在 commit 之后、不看 commit 是否真的落盘：被更新的本地读取顶掉只说明
    // 本标签页有更新的数，不说明这份样本对【其它】标签页无用；对端自己会按
    // sampleAt 排序。广播失败不影响本标签页，钩子内部已经静默。
    attentionPublisher?.(count, sampleAt);
    return { count, sampleAt };
}
