import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// SummaryDetailPage import wukongimjssdk，测试环境会拉起无关依赖导致解析失败，mock 掉。
vi.mock('wukongimjssdk', () => ({
    Channel: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));
vi.mock('@douyinfe/semi-ui', () => {
    const Passthrough = ({ children }: any) => children ?? null;
    const Typography: any = Passthrough;
    Typography.Text = Passthrough;
    const Dropdown: any = Passthrough;
    Dropdown.Menu = Passthrough;
    Dropdown.Item = Passthrough;
    return {
        Button: Passthrough,
        Typography,
        Tag: Passthrough,
        Avatar: Passthrough,
        Spin: Passthrough,
        Modal: Passthrough,
        Banner: Passthrough,
        Input: Passthrough,
        Checkbox: Passthrough,
        Empty: Passthrough,
        Dropdown,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
    IconArrowLeft: () => null,
    IconRefresh: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
    IconMore: () => null,
    IconSend: () => null,
    IconChevronDown: () => null,
    IconUser: () => null,
    IconTick: () => null,
    IconClose: () => null,
    IconInfoCircle: () => null,
    IconHistory: () => null,
    IconSearch: () => null,
}));

import * as api from '../../api/summaryApi';
import SummaryDetailPage from '../SummaryDetailPage';

vi.mock('../../api/summaryApi');

function makePage(taskId: number | string) {
    const page = new SummaryDetailPage({ taskId } as any);
    (page as any).context = { t: (k: string) => k };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

const baseDetail = (over: any = {}) => ({
    task_id: 1,
    task_no: 'T1',
    title: 't',
    summary_mode: 1,
    status: 5, // 已完成-ish，避免触发 fallback poll 分支无所谓
    trigger_type: 0,
    time_range_start: '',
    time_range_end: '',
    sources: [],
    participants: [],
    result: null,
    error_message: null,
    created_at: '',
    updated_at: '',
    permissions: { can_edit: true, can_schedule: true },
    ...over,
});

describe('SummaryDetailPage — Blocking 5: scheduleItem must track current detail', () => {
    beforeEach(() => vi.clearAllMocks());

    it('clears stale scheduleItem when navigating to a detail with no schedule', async () => {
        // 模拟从「有定时」总结切到「无定时」总结：先有残留 scheduleItem。
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ schedule_id: 0 }) as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 99, is_active: true } as any, // A 的残留
        };

        await page.loadDetail();

        // B 无定时 → 必须显式清空，避免串台。
        expect((page.state as any).scheduleItem).toBeNull();
        // 不应去拉取任何 schedule。
        expect(api.getSchedule).not.toHaveBeenCalled();
    });

    it('loadSchedule failure clears scheduleItem (no stale leak)', async () => {
        vi.mocked(api.getSchedule).mockRejectedValue(new Error('boom'));

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 99, is_active: true } as any,
        };

        await page.loadSchedule(123);

        expect((page.state as any).scheduleItem).toBeNull();
    });

    it('loads schedule when detail has a valid schedule_id', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ schedule_id: 55 }) as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 55, is_active: true } as any);

        const page = makePage(1);
        await page.loadDetail();

        expect(api.getSchedule).toHaveBeenCalledWith(55);
    });

    // 核心 blocker（async race / 跨 task 串台）：
    // 场景：从 summary A（有 schedule）切到 summary B（无 schedule），A 的 loadSchedule
    // 请求延迟返回。修复前：A 的响应会把 A 的 scheduleItem 覆盖到 B 的 state，
    // 导致 B 误显示「有定时」、保存时把 A 的定时误绑到 B 的 task。
    // 修复后：seq/taskId 不一致 → 丢弃旧响应，B 的 scheduleItem 保持为 null。
    it('discards a stale loadSchedule response after switching to another task (no cross-task leak)', async () => {
        // A 的 getSchedule 手动控制 resolve 时机，模拟「切完 task 才返回」。
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getSchedule).mockReturnValueOnce(aPending as any);

        // detail A：有定时 schedule_id=900。
        vi.mocked(api.getSummaryDetail).mockResolvedValueOnce(
            baseDetail({ task_id: 1, schedule_id: 900 }) as any,
        );

        const page = makePage(1);
        // 启动 A 的加载：loadDetail 会 fire loadSchedule(900)，但 getSchedule 还未 resolve。
        await page.loadDetail();
        expect(api.getSchedule).toHaveBeenCalledWith(900);

        // 切到 task B（无定时）：模拟 props.taskId 变化 + componentDidUpdate 走 loadDetail。
        vi.mocked(api.getSummaryDetail).mockResolvedValueOnce(
            baseDetail({ task_id: 2, schedule_id: 0 }) as any,
        );
        (page as any).props = { taskId: 2 };
        page.componentDidUpdate({ taskId: 1 } as any);
        // 等 B 的 loadDetail 完成（同步清空 + getSummaryDetail resolve + 显式清空）。
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        // B 无定时 → scheduleItem 应为 null。
        expect((page.state as any).scheduleItem).toBeNull();

        // A 的 loadSchedule 现在才迟迟 resolve——修复后必须被丢弃。
        resolveA({ schedule_id: 900, is_active: true });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 关键断言：A 的定时绝不能污染 B 的 state。
        expect((page.state as any).scheduleItem).toBeNull();
    });
});

describe('SummaryDetailPage — mark-read list synchronization', () => {
    beforeEach(() => vi.clearAllMocks());

    it('dispatches the numeric task id for a task_no deep-link and preserves server attention state', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({
            task_id: 740,
            task_no: 'SUM-740',
            status: 3,
            result_id: 91,
            result: 'summary',
        }) as any);
        vi.mocked(api.markSummaryRead).mockResolvedValue({
            is_unread: false,
            has_pending_invitation: true,
            needs_attention: true,
        });
        const listener = vi.fn();
        window.addEventListener('summary-read', listener);

        const page = makePage('SUM-740');
        await page.loadDetail();
        await Promise.resolve();

        expect(api.markSummaryRead).toHaveBeenCalledWith(740, { team_result_id: 91 });
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
            taskId: 740,
            isUnread: false,
            needsAttention: true,
        });
        window.removeEventListener('summary-read', listener);
    });
});

// ─── FE-1（blocking）：切任务竞态——旧任务 members/personalResult 迟到返回不得 setState 到新任务 ───
//
// 背景：loadDetail 拿到 detail 后，loadPersonalResult / loadMembers 是二次异步请求。
// 用户快速切任务时，旧任务的 in-flight 请求返回后会把【旧任务的 members / personalResult】
// setState 到【新任务】界面上 → 泄漏别的任务成员报告内容，并污染 team citations /
// schedule participant 写入。修复：复用 loadSchedule 同款 seq(scheduleLoadSeq)+taskId
// 归属校验——发起时捕获 reqSeq+requestTaskId，异步返回后不一致一律忽略(return)，不 setState；
// 且 loadDetail 入口同步清空 stale personalResult/members。
describe('SummaryDetailPage — FE-1: 切任务竞态，旧 members/personalResult 迟到返回被忽略', () => {
    beforeEach(() => vi.clearAllMocks());

    it('string task_no detail load starts BY_PERSON secondary fetches with numeric detail.task_id', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2 }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: '我的报告', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid'), member('u_b')] as any);

        const page = makePage('SUM-740');
        const queuedSetStates: any[] = [];
        (page as any).setState = function (this: any, patch: any, callback?: () => void) {
            queuedSetStates.push({ patch, callback });
        };

        await page.loadDetail();

        expect(api.getSummaryDetail).toHaveBeenCalledWith('SUM-740');
        expect(api.getPersonalResult).toHaveBeenCalledWith(740);
        expect(api.getMembers).toHaveBeenCalledWith(740);
        expect(queuedSetStates.some(({ patch }) => patch?.detail?.task_id === 740)).toBe(true);
        // M1 回归：detail 的 setState 在本 mock 下永不提交（this.taskId 一直为 null），
        // 模拟字符串深链首载时 secondary fetch 先于 detail 提交返回的竞态窗口。
        // 修复前旧守卫 this.taskId!==requestTaskId 会把 null!==740 判为切 task、
        // 静默丢弃 personalResult/members；修复后必须仍将其 setState。
        expect(queuedSetStates.some(({ patch }) => patch?.personalResult?.content === '我的报告')).toBe(true);
        expect(queuedSetStates.some(({ patch }) => Array.isArray(patch?.members) && patch.members.length === 2)).toBe(true);
    });

    // loadDetail 入口必须同步清空上一 task 的 personalResult/members，避免新 detail 返回前残留显示。
    it('loadDetail clears stale personalResult/members at entry (no leak before new detail resolves)', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 9, summary_mode: 1 /* BY_GROUP，不触发二次加载 */ }) as any,
        );
        const page = makePage(9);
        // 预置上一 task 的残留数据。
        page.state = {
            ...(page.state as any),
            personalResult: { content: '旧任务的个人报告', worker_status: 2, submitted_at: null } as any,
            members: [member('old-a'), member('old-b')] as any,
        };

        await page.loadDetail();

        // 切任务开始加载即清空 → 不会把旧任务成员/个人报告残留到新任务界面。
        expect((page.state as any).personalResult).toBeNull();
        expect((page.state as any).members).toEqual([]);
    });

    // 核心 blocker：旧任务 loadMembers 迟到 resolve，taskId 已切到新任务 → 必须丢弃，不 setState。
    it('discards a stale loadMembers response after switching task (no cross-task member leak)', async () => {
        // A（task=1）的 getMembers 手动控制 resolve 时机，模拟「切完 task 才返回」。
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getMembers).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        // 直接发起 A 的 loadMembers（带 A 当前的 seq 基准——不传则内部 bump）。
        const aSeq = (page as any).scheduleLoadSeq + 1;
        const pending = page.loadMembers(aSeq);
        // bump seq 到 A 的基准，使其成为「当时最新」。
        (page as any).scheduleLoadSeq = aSeq;
        expect(api.getMembers).toHaveBeenCalledWith(1);

        // 切到 task B：props.taskId 变 + seq 再 bump（模拟新一轮 loadDetail）。
        (page as any).props = { taskId: 2 };
        (page as any).scheduleLoadSeq = aSeq + 1; // 新一轮加载令 A 作废
        page.state = { ...(page.state as any), members: [] };

        // A 的 getMembers 现在才迟迟 resolve——含旧任务成员，必须被丢弃。
        resolveA([member('leaked-old-member')]);
        await pending;

        // 关键断言：旧任务成员绝不能 setState 到新任务。
        expect((page.state as any).members).toEqual([]);
    });

    // 旧任务 loadPersonalResult 迟到 resolve，taskId 已切 → 丢弃，不 setState（不泄漏他人报告）。
    it('discards a stale loadPersonalResult response after switching task', async () => {
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getPersonalResult).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const aSeq = (page as any).scheduleLoadSeq + 1;
        const pending = page.loadPersonalResult(aSeq);
        (page as any).scheduleLoadSeq = aSeq;
        expect(api.getPersonalResult).toHaveBeenCalledWith(1);

        // 切 task + 新一轮加载作废 A。
        (page as any).props = { taskId: 2 };
        (page as any).scheduleLoadSeq = aSeq + 1;
        page.state = { ...(page.state as any), personalResult: null };

        resolveA({ content: '旧任务的个人报告', worker_status: 2, submitted_at: null });
        await pending;

        // 旧任务个人报告绝不能回填到新任务。
        expect((page.state as any).personalResult).toBeNull();
    });

    // 守卫逻辑直接验证：reqSeq 与当前 scheduleLoadSeq 不匹配时忽略（不 setState）。
    it('ignores response when reqSeq no longer matches current scheduleLoadSeq (guard hit)', async () => {
        vi.mocked(api.getMembers).mockResolvedValue([member('x')] as any);
        const page = makePage(1);
        // 用一个「过期」seq 发起：传入的 seq 比当前 scheduleLoadSeq 小。
        const staleSeq = (page as any).scheduleLoadSeq; // 当前值
        (page as any).scheduleLoadSeq = staleSeq + 5;   // 之后又切了好几轮
        page.state = { ...(page.state as any), members: [] };

        await page.loadMembers(staleSeq);

        // seq 不匹配 → 守卫命中，忽略响应，members 保持空。
        expect((page.state as any).members).toEqual([]);
    });

    // taskId 不匹配时也忽略（即便 seq 凑巧一致）。
    it('ignores response when requestTaskId no longer matches current taskId (guard hit)', async () => {
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getMembers).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const seq = (page as any).scheduleLoadSeq + 1;
        const pending = page.loadMembers(seq);
        (page as any).scheduleLoadSeq = seq; // seq 保持一致
        // 只改 taskId（不再 bump seq），验证 taskId 这一维守卫单独生效。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), members: [] };

        resolveA([member('leaked')]);
        await pending;

        expect((page.state as any).members).toEqual([]);
    });
});

// ─── 续修1（blocking）：成对 refresh 共用一个 seq，不互相作废 ───
//
// 问题：handleStatusChangeEvent / fallback poll 终态处成对调用 loadPersonalResult()/loadMembers()，
// 不传 seq 时各自 nextScheduleSeq() 自增 → 第二个把第一个的 reqSeq 作废 → 第一个响应被丢弃
//（personalLoading 卡 true）。修复：一个刷新周期共用一个 seq，传给所有子加载。
describe('SummaryDetailPage — 续修1: 成对 refresh 共用一个 seq，两者结果都落地', () => {
    beforeEach(() => vi.clearAllMocks());

    // handleStatusChangeEvent 触发的成对 refresh：personalResult 与 members 都能 setState（不互杀）。
    it('handleStatusChangeEvent paired refresh: both personalResult and members land (no mutual invalidation)', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 1, status: 3, summary_mode: 2 }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: '我的报告', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid'), member('u_b')] as any);

        const page = makePage(1);
        page.state = { ...(page.state as any), lastKnownStatus: 2 /* PROCESSING，与新状态不同 */ };

        await (page as any).handleStatusChangeEvent(
            new CustomEvent('summary-status-change', { detail: { taskIds: [1] } }),
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 两者都落地：证明共用一个 seq、不互相作废。
        expect((page.state as any).personalResult).not.toBeNull();
        expect((page.state as any).members).toHaveLength(2);
        expect((page.state as any).personalLoading).toBe(false);
        expect((page.state as any).membersLoading).toBe(false);
    });

    // 直接验证「同一个 seq 传给两个子加载」后二者互不作废。
    it('passing the same seq to both loaders lets both results land', async () => {
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: 'p', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('a'), member('b')] as any);

        const page = makePage(1);
        const seq = (page as any).nextScheduleSeq();
        await Promise.all([page.loadPersonalResult(seq), page.loadMembers(seq)]);

        expect((page.state as any).personalResult).not.toBeNull();
        expect((page.state as any).members).toHaveLength(2);
    });
});

// ─── 续修2（blocking）：startPersonalPoll 轮询回调切任务不串台 ───
//
// 问题：轮询回调 await getPersonalResult 后直接 setState，无 taskId 守卫。切任务时
// clearInterval 停不住已在途请求，A 的结果会写进 B 的 personalResult。
// 修复：进回调捕获 requestTaskId，await 后 setState 前校验 this.taskId === requestTaskId。
describe('SummaryDetailPage — 续修2: startPersonalPoll 轮询回调 taskId 守卫（切任务不串台）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('discards a stale poll response after switching task (no cross-task personalResult leak)', async () => {
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getPersonalResult).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        // worker_status=0 → 启动轮询定时器。
        page.startPersonalPoll(0);
        // 推进 5s 触发一次 tick（发起 getPersonalResult(1)，未 resolve）。
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.getPersonalResult).toHaveBeenCalledWith(1);

        // 切到 task B。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), personalResult: null };

        // A 的轮询请求现在才迟迟 resolve——含 A 的个人报告，必须被丢弃。
        resolveA({ content: 'A 任务的个人报告', worker_status: 2, submitted_at: null });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // 关键断言：A 的轮询结果绝不能 setState 到 B。
        expect((page.state as any).personalResult).toBeNull();
    });

    it('poll callback writes personalResult when taskId unchanged (legit same-task tick not killed)', async () => {
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: '同 task 最新报告', worker_status: 1, submitted_at: null } as any,
        );

        const page = makePage(1);
        page.startPersonalPoll(1);
        await vi.advanceTimersByTimeAsync(5000);
        await Promise.resolve();
        await Promise.resolve();

        // taskId 未变 → 合法 tick 正常写入，不被误杀。
        expect((page.state as any).personalResult).not.toBeNull();
        expect((page.state as any).personalResult.content).toBe('同 task 最新报告');
    });
});

// ─── 续修3/4（blocking）：detail 写入路径同病 race（状态事件 / 兑底轮询）───
//
// handleStatusChangeEvent / doFallbackPollOnce 都 await api.getSummaryDetail 后直接
// setState({ detail })，之前未捕获 requestTaskId。await 期间切 task，A 的 detail
//（含 result.team_citations）会写进 B 页 → A detail + B members/personal 混搭串台。
// 修复：await 前捕获 requestTaskId，写 detail 前 if (this.taskId !== requestTaskId) return。
describe('SummaryDetailPage — 续修3/4: detail 写入路径切 task 迟到丢弃', () => {
    beforeEach(() => vi.clearAllMocks());

    // 续修3：handleStatusChangeEvent 的 getSummaryDetail 在切 task 后迟到返回 → 旧 detail 不覆盖新 task。
    it('handleStatusChangeEvent discards a stale detail after switching task', async () => {
        // A（task=1）的 getSummaryDetail 手动控制 resolve。
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getSummaryDetail).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        // 预置 B 的 detail（切完 task 后应保留的）。
        const bDetail = baseDetail({ task_id: 2, title: 'B-detail' });

        // 启动 A 的状态事件处理（发起 getSummaryDetail(1)，未 resolve）。
        const pending = (page as any).handleStatusChangeEvent(
            new CustomEvent('summary-status-change', { detail: { taskIds: [1] } }),
        );
        expect(api.getSummaryDetail).toHaveBeenCalledWith(1);

        // 切到 task B。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), detail: bDetail };

        // A 的 getSummaryDetail 现在才迟迟 resolve——含 A 的 detail，必须被丢弃。
        resolveA(baseDetail({ task_id: 1, title: 'A-detail', status: 3 }) as any);
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        // 关键断言：B 的 detail 不被 A 覆盖。
        expect((page.state as any).detail.task_id).toBe(2);
        expect((page.state as any).detail.title).toBe('B-detail');
    });

    // 续修4：doFallbackPollOnce 的 getSummaryDetail 在切 task 后迟到返回 → 旧 detail 不覆盖新 task。
    it('doFallbackPollOnce discards a stale detail after switching task', async () => {
        // batchStatus 立即返回状态变化（触发 getSummaryDetail）。
        vi.mocked(api.batchStatus).mockResolvedValue([{ id: 1, status: 3 }] as any);
        // getSummaryDetail 手动控制 resolve。
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.getSummaryDetail).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const bDetail = baseDetail({ task_id: 2, title: 'B-detail' });
        page.state = { ...(page.state as any), lastKnownStatus: 2 /* 与新状态 3 不同，进入 detail 拉取 */ };

        // 启动一次兑底轮询：batchStatus resolve → 发起 getSummaryDetail(1)（未 resolve）。
        const pending = (page as any).doFallbackPollOnce();
        await Promise.resolve();
        await Promise.resolve();
        expect(api.getSummaryDetail).toHaveBeenCalledWith(1);

        // 切到 task B。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), detail: bDetail };

        // A 的 getSummaryDetail 迟到 resolve——必须被丢弃。
        resolveA(baseDetail({ task_id: 1, title: 'A-detail', status: 3 }) as any);
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        // B 的 detail 不被 A 覆盖。
        expect((page.state as any).detail.task_id).toBe(2);
        expect((page.state as any).detail.title).toBe('B-detail');
    });
});

// ─── 续修5/6/7（blocking）：schedule 用户操作路径切 task 迟到丢弃 ───
//
// 根因：handleScheduleSave / handleScheduleDisable / handleConfirmSchedule 在【用户操作入口】
// 未捕获 requestTaskId，await 后才调 loadSchedule()/setState scheduleItem。loadSchedule 内部捕获的
// requestTaskId 是【它被调用那一刻】的 this.taskId——此时已切到 B，于是 A 的 schedule 被当成 B
// 写进 scheduleItem。修复：入口捕获 requestTaskId，调 loadSchedule / 动 UI 前 if (this.taskId !== requestTaskId) return。
describe('SummaryDetailPage — 续修5/6/7: schedule 用户操作路径切 task 迟到丢弃', () => {
    beforeEach(() => vi.clearAllMocks());

    // 续修5：handleScheduleSave 新建定时，createSchedule 在切 task 后迟到返回 → 不回显到 B。
    it('handleScheduleSave: stale createSchedule response after switching task does not load/setState schedule for new task', async () => {
        // createSchedule 手动控制 resolve，模拟「切完 task 才返回」。
        let resolveCreate: (v: any) => void = () => {};
        const createPending = new Promise((res) => { resolveCreate = res; });
        vi.mocked(api.createSchedule).mockReturnValueOnce(createPending as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 999, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ task_id: 1, schedule_id: 0 }),
            scheduleItem: null, // 进入「新建定时」分支
            members: [member('test-uid')], // 单人，跳过 members guard
        };

        // 发起保存（createSchedule(1) 未 resolve）。
        const pending = page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);
        await Promise.resolve();
        expect(api.createSchedule).toHaveBeenCalled();

        // 切到 task B。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), scheduleItem: null, showScheduleConfig: true };

        // create 迟到 resolve——回显环节必须被跳过。
        resolveCreate({ schedule_id: 999 });
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        // 关键断言：切 task 后不再拉 schedule 回显、不动 B 的 scheduleItem。
        expect(api.getSchedule).not.toHaveBeenCalled();
        expect((page.state as any).scheduleItem).toBeNull();
    });

    // 续修6：handleScheduleDisable 在切 task 后迟到返回 → 不写 B 的 scheduleItem，且复位 loading。
    it('handleScheduleDisable: stale toggle response after switching task does not setState schedule for new task (loading reset)', async () => {
        let resolveToggle: (v: any) => void = () => {};
        const togglePending = new Promise((res) => { resolveToggle = res; });
        vi.mocked(api.toggleSchedule).mockReturnValueOnce(togglePending as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 50, is_active: true } as any,
        };

        const pending = page.handleScheduleDisable();
        await Promise.resolve();
        expect(api.toggleSchedule).toHaveBeenCalledWith(50, false);

        // 切到 task B（B 无定时）。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), scheduleItem: null, scheduleDisabling: true };

        // toggle 迟到 resolve——不得把 A 的停用结果写进 B。
        resolveToggle({ schedule_id: 50, is_active: false });
        await pending;
        await Promise.resolve();

        // B 的 scheduleItem 仍为 null（未被 A 回显污染）；loading 已复位，不卡住。
        expect((page.state as any).scheduleItem).toBeNull();
        expect((page.state as any).scheduleDisabling).toBe(false);
    });

    // 续修7：handleConfirmSchedule 在切 task 后迟到返回 → 不回显 B，confirmingSchedule 由 finally 复位。
    it('handleConfirmSchedule: stale confirm response after switching task does not load schedule for new task', async () => {
        let resolveConfirm: (v: any) => void = () => {};
        const confirmPending = new Promise((res) => { resolveConfirm = res; });
        vi.mocked(api.confirmSchedule).mockReturnValueOnce(confirmPending as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 60, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 60, is_active: true, confirm_policy: 1 } as any,
        };

        const pending = page.handleConfirmSchedule();
        await Promise.resolve();
        expect(api.confirmSchedule).toHaveBeenCalledWith(60);

        // 切到 task B。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), scheduleItem: null, confirmingSchedule: true };

        resolveConfirm({});
        await pending;
        await Promise.resolve();

        // 不重拉 schedule 回显，confirmingSchedule 由 finally 复位。
        expect(api.getSchedule).not.toHaveBeenCalled();
        expect((page.state as any).confirmingSchedule).toBe(false);
    });
});

// 回归：「无定时」总结新建定时改为一步式 createSchedule（scope='task' + task_id）。
// 后端 create 在 scope=task 时已在一个事务里原子完成「建定时 + 绑定 summary_task.schedule_id」，
// 前端不再走两步式（create 再 update 绑定），也不再有 B2 回滚（不会产生游离/孤儿定时）。
describe('SummaryDetailPage — new schedule: one-step create (scope=task)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates schedule in one step with scope=task + task_id, then loads it (no updateSchedule/deleteSchedule)', async () => {
        const NEW_ID = 321;
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: NEW_ID } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: NEW_ID, is_active: true } as any);

        const { Toast } = await import('@douyinfe/semi-ui');

        const page = makePage(1);
        // 无 scheduleItem → 进入「新建定时」分支。
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 一步式 create：参数里直接带 scope='task' + task_id。
        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1 }),
        );
        // 不再有第二步绑定、也不再回滚。
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        // 拉取刚建并已绑定的定时回显。
        expect(api.getSchedule).toHaveBeenCalledWith(NEW_ID);
        expect(Toast.success).toHaveBeenCalled();
    });

    it('on create failure: only Toast.error, no rollback (no deleteSchedule)', async () => {
        vi.mocked(api.createSchedule).mockRejectedValue(new Error('一对一约束'));

        const { Toast } = await import('@douyinfe/semi-ui');

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 后端事务原子回滚，前端不再产生游离定时 → 不调 deleteSchedule。
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        // 透出后端 message。
        expect(Toast.error).toHaveBeenCalled();
        expect(Toast.success).not.toHaveBeenCalled();
    });
});

// ─── V5（第2轮回炉）：多人写定时路径必须带 confirm_policy；确认入口按 confirm_policy 分两条路 ───
//
// 判定「多人」的数据源：详情页已加载的 this.state.members（api.getMembers 返回全体成员，
// 含 creator + 非 creator 协作成员），与本页其他多人判定（members.length>1）一致。
// 多人 → confirm_policy=1（CONFIRM）；单人 → 不传，走后端兜底。
const member = (uid: string) => ({ user_id: uid, user_name: uid, status: 'pending', submitted_at: null });

describe('SummaryDetailPage — V5 confirm_policy on schedule write paths', () => {
    beforeEach(() => vi.clearAllMocks());

    it('multi-person create (manual→scheduled) sends confirm_policy=1', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
            members: [member('test-uid'), member('u_b')], // 多人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('single-person create omits confirm_policy (backend fallback)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
            members: [member('test-uid')], // 单人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        expect('confirm_policy' in arg).toBe(false);
    });

    it('multi-person update (edit/convert schedule) sends confirm_policy=1', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 7, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 7 }),
            // 已存在 schedule（active）→ 进入 update 分支
            scheduleItem: { schedule_id: 7, is_active: true } as any,
            members: [member('test-uid'), member('u_b'), member('u_c')], // 多人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('single-person update omits confirm_policy', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 7, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 7 }),
            scheduleItem: { schedule_id: 7, is_active: true } as any,
            members: [member('test-uid')], // 单人
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.updateSchedule).mock.calls[0][1] as any;
        expect('confirm_policy' in arg).toBe(false);
    });

    // 🐛 REGRESSION: 多人「手动转定时」必须显式带上协作名单，否则后端
    // 拿到空 participants 会把 config 退化成单人（丢掉协作成员）。
    it('multi-person create forwards participants (collaborators not dropped)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0 }),
            scheduleItem: null,
            members: [member('test-uid'), member('u_b')], // creator + 协作成员
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        expect(Array.isArray(arg.participants)).toBe(true);
        const ids = arg.participants.map((p: any) => p.user_id);
        expect(ids).toContain('test-uid');
        expect(ids).toContain('u_b'); // 协作成员未被丢失
    });

    // detail.participants 优先作为数据源（不受二次异步 members 竞态影响）。
    it('create prefers detail.participants for the forwarded roster', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({
                schedule_id: 0,
                participants: [
                    { user_id: 'test-uid', user_name: 'Creator' },
                    { user_id: 'danno', user_name: 'Danno' },
                ],
            }),
            scheduleItem: null,
            members: [], // members 未加载；应从 detail.participants 取
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        const ids = arg.participants.map((p: any) => p.user_id);
        expect(ids).toEqual(expect.arrayContaining(['test-uid', 'danno']));
        expect(arg.confirm_policy).toBe(1); // detail.participants.length>1 → 多人
    });

    // 多人 update（改/转定时）同样显式带上协作名单。
    it('multi-person update forwards participants', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 7, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 7 }),
            scheduleItem: { schedule_id: 7, is_active: true } as any,
            members: [member('test-uid'), member('u_b'), member('u_c')],
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        const arg = vi.mocked(api.updateSchedule).mock.calls[0][1] as any;
        const ids = arg.participants.map((p: any) => p.user_id);
        expect(ids).toEqual(expect.arrayContaining(['test-uid', 'u_b', 'u_c']));
    });
});

// finding 2：WAITING_CONFIRM 入口按 confirm_policy 区分 V5-schedule 级 vs 旧 task 级两条路。
describe('SummaryDetailPage — V5 vs legacy confirm routing (isV5ScheduleConfirm)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('V5 CONFIRM task (confirm_policy===1) → schedule-level path, NOT legacy task page', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 1 } as any,
        };
        expect((page as any).isV5ScheduleConfirm()).toBe(true);
    });

    it('legacy task-level confirm (no schedule) → keeps SummaryConfirmPage path', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), scheduleItem: null };
        expect((page as any).isV5ScheduleConfirm()).toBe(false);
    });

    it('schedule without CONFIRM policy (AUTO/0 or undefined) → legacy path', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 0 } as any,
        };
        expect((page as any).isV5ScheduleConfirm()).toBe(false);
    });

    // needsScheduleConfirm：当前用户（test-uid）在名单且未确认 → 需确认；已确认 → 不需。
    it('needsScheduleConfirm true when current user unconfirmed in participant_config', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: {
                schedule_id: 9, is_active: true, confirm_policy: 1,
                participant_config: { participants: [{ user_id: 'test-uid', confirmed: false }, { user_id: 'u_b', confirmed: true }] },
            } as any,
        };
        expect((page as any).needsScheduleConfirm()).toBe(true);
    });

    it('needsScheduleConfirm false when current user already confirmed', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: {
                schedule_id: 9, is_active: true, confirm_policy: 1,
                participant_config: { participants: [{ user_id: 'test-uid', confirmed: true }] },
            } as any,
        };
        expect((page as any).needsScheduleConfirm()).toBe(false);
    });
});

// ─── 竞态修复（第3轮回炉）：异步加载竞态消除 ───
//
// 背景：loadDetail 拿到 detail 后，loadSchedule 与 loadMembers 是两个独立的二次异步请求，
// 到达时间不确定。修复前：
//   - isMultiPerson() 只看 members.length>1 → members 未到时多人任务被误判单人 → 漏 confirm_policy。
//   - WAITING_CONFIRM 渲染只看 isV5ScheduleConfirm()(scheduleItem.confirm_policy===1) →
//     scheduleItem 未到时 V5 任务 fallback 到旧 SummaryConfirmPage。
// 修复：多人判定优先用同步随 detail 返回的 detail.participants；members 仅作兜底，且兜底时
//      members 加载中禁止保存；WAITING_CONFIRM 在 scheduleLoading 期间不 fallback 旧页。

describe('SummaryDetailPage — finding 1: 多人判定不被 members 二次异步竞态误判', () => {
    beforeEach(() => vi.clearAllMocks());

    // 关键窗口：members 尚未回填（[] 且 membersLoading=true），但 detail.participants 已含多人。
    // 修复前 isMultiPerson() 看 members.length>1 → false → 漏 confirm_policy=1。
    // 修复后 isMultiPerson() 优先看 detail.participants → true → 仍带 confirm_policy=1。
    it('multi-person create sends confirm_policy=1 even while members not loaded yet (detail.participants is the reliable source)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({
                schedule_id: 0,
                participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }], // detail 已知多人
            }),
            scheduleItem: null,
            members: [],            // members 二次异步尚未回填
            membersLoading: true,   // 正在加载中
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 多人 → confirm_policy=1，未因 members 未到而误判单人。
        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: 1, confirm_policy: 1 }),
        );
    });

    it('isMultiPerson prefers detail.participants over (empty) members', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [{ user_id: 'a' }, { user_id: 'b' }] }),
            members: [],
        };
        expect((page as any).isMultiPerson()).toBe(true);
    });

    it('isMultiPerson falls back to members when detail has no participants', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [] }),
            members: [member('a'), member('b')],
        };
        expect((page as any).isMultiPerson()).toBe(true);
    });
});

describe('SummaryDetailPage — finding 1 guard: members 加载中（且需兜底）禁止保存，避免误判单人', () => {
    beforeEach(() => vi.clearAllMocks());

    // 兜底路径（detail.participants 缺失）+ members 仍在加载 → 不能保存（不能把"加载中"当单人）。
    it('blocks save (no createSchedule) when falling back to members and membersLoading=true', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0, participants: [] }), // 无 participants → 需兜底
            scheduleItem: null,
            members: [],
            membersLoading: true,   // 加载中
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        // 加载中 → 阻止保存并提示，绝不发起写请求（否则可能漏 confirm_policy）。
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(Toast.warning).toHaveBeenCalled();
    });

    // 区分"加载中" vs "确实单人"：membersLoading=false 且 members 确为单人 → 允许保存（不带 confirm_policy）。
    it('allows save when members loaded and genuinely single-person (not blocked)', async () => {
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.getSchedule).mockResolvedValue({ schedule_id: 1, is_active: true } as any);

        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ schedule_id: 0, participants: [] }), // 无 participants → 兜底 members
            scheduleItem: null,
            members: [member('test-uid')], // 确实单人
            membersLoading: false,         // 已加载完成
        };

        await page.handleScheduleSave({ unit: 'week', every: 1, time: '09:00' } as any);

        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(api.createSchedule).mock.calls[0][0] as any;
        expect('confirm_policy' in arg).toBe(false); // 单人不带
    });

    it('isMembersReadyForSave: detail.participants 存在则始终就绪（不依赖 members 加载）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [{ user_id: 'a' }, { user_id: 'b' }] }),
            membersLoading: true, // 即便 members 加载中
        };
        expect((page as any).isMembersReadyForSave()).toBe(true);
    });

    it('isMembersReadyForSave: 兜底时 membersLoading=true → 未就绪', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ participants: [] }),
            membersLoading: true,
        };
        expect((page as any).isMembersReadyForSave()).toBe(false);
    });
});

// finding 2：WAITING_CONFIRM 入口在 scheduleItem 二次异步未到（scheduleLoading）期间，
// 不得 fallback 到旧 SummaryConfirmPage 按钮，避免 V5 CONFIRM 任务瞬时落旧 task 级确认流。
// 渲染分路决策抽到 waitingConfirmMode()：'loading' | 'v5' | 'legacy'。
// 'legacy' 是唯一会渲染旧 SummaryConfirmPage 按钮的分路。
describe('SummaryDetailPage — finding 2: scheduleLoading 期间 WAITING_CONFIRM 不落旧 SummaryConfirmPage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('scheduleLoading=true (scheduleItem 未到) → mode=loading（不暴露任何确认入口，绝不 fallback 旧页）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: null,     // 二次异步尚未回填
            scheduleLoading: true,  // 加载中
        };
        expect((page as any).waitingConfirmMode()).toBe('loading');
    });

    it('scheduleLoading=true 即便已有 confirm_policy≠1 残留也不 legacy（先判加载态）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 1, confirm_policy: 0 } as any,
            scheduleLoading: true,
        };
        // 不能在加载中就用旧值判 legacy → 仍是 loading。
        expect((page as any).waitingConfirmMode()).toBe('loading');
    });

    it('scheduleLoading=false 且 V5 CONFIRM（confirm_policy=1）→ mode=v5（不渲染旧按钮）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 1 } as any,
            scheduleLoading: false,
        };
        expect((page as any).waitingConfirmMode()).toBe('v5');
    });

    it('scheduleLoading=false 且确无 schedule → mode=legacy（保留合法旧路径）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: null,      // 确无 schedule
            scheduleLoading: false,  // 已加载完成
        };
        expect((page as any).waitingConfirmMode()).toBe('legacy');
    });

    it('scheduleLoading=false 且非 V5（confirm_policy=0）→ mode=legacy', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            scheduleItem: { schedule_id: 9, is_active: true, confirm_policy: 0 } as any,
            scheduleLoading: false,
        };
        expect((page as any).waitingConfirmMode()).toBe('legacy');
    });
});

// ─── 需求1（本轮）：多人详情页定时入口可见性对齐普通任务 ───
//
// 背景：多人（BY_PERSON）详情页定时按钮之前被门控成
//   `(summary_mode !== BY_PERSON || !personalResult || personalLoading) && renderScheduleButton()`
// → 多人任务一旦 personalResult 已加载，header 的定时按钮被隐藏；
// personalResult 未生成时又被塞进 personal 区（依赖 personalResult）→ 两处都不出。
// 修复：renderScheduleButton() 仅依赖 permissions.can_edit / isEditing（其内部门控），
// 与 personalResult / summary_mode 解耦；header 无条件渲染；personal 区不再重复渲染。
describe('SummaryDetailPage — 需求1: 多人详情页定时入口与 BY_GROUP 一致可见', () => {
    beforeEach(() => vi.clearAllMocks());

    // fail-before / pass-after 核心：BY_PERSON 且 personalResult 未生成时，
    // renderScheduleButton() 仍须返回非 null（以前 header 门控会把它藏掉）。
    // B1（第二轮）：定时按钮改判 permissions.can_schedule（任务级配置，creator 单/多人都可设）。
    it('renderScheduleButton stays non-null for BY_PERSON even when personalResult is absent', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2 /* BY_PERSON */, permissions: { can_edit: true, can_schedule: true } }),
            personalResult: null,   // 个人总结未生成
            personalLoading: false,
            scheduleItem: null,
            isEditing: false,
        };
        // 定时按钮与 personalResult 解耦，依然渲染。
        expect((page as any).renderScheduleButton()).not.toBeNull();
    });

    // B1：定时按钮门控由 can_edit 改为 can_schedule。creator 多人任务后端给 can_schedule=true，
    // 即便（极端）can_edit=false 也应能设定时；非 creator can_schedule=false → 不渲染。
    it('renderScheduleButton gated by can_schedule (renders when can_schedule=true even if can_edit=false)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2, permissions: { can_edit: false, can_schedule: true } }),
            personalResult: null,
            isEditing: false,
        };
        expect((page as any).renderScheduleButton()).not.toBeNull();
    });

    it('renderScheduleButton returns null without can_schedule (non-creator)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2, permissions: { can_edit: true, can_schedule: false } }),
            personalResult: null,
            isEditing: false,
        };
        expect((page as any).renderScheduleButton()).toBeNull();
    });

    it('renderScheduleButton still gated by isEditing (returns null while editing)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2, permissions: { can_edit: true, can_schedule: true } }),
            personalResult: null,
            isEditing: true,
        };
        expect((page as any).renderScheduleButton()).toBeNull();
    });

    // 批次B need5（取代上一轮「header 无条件渲染定时按钮」）：定时按钮已从顶部 header 移除，
    // 改放到团队框（多人）/ 编辑按钮左侧（单人）。故 header 不应再含定时按钮文案。
    it('renderHeader no longer includes the schedule button (need5: moved out of top header)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2, status: 3, permissions: { can_edit: true, can_schedule: true } }),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            scheduleItem: null,
            isEditing: false,
            members: [member('test-uid'), member('u_b')],
            forwardingToMatter: false,
        };
        const header = (page as any).renderHeader();
        const json = JSON.stringify(header);
        expect(json).not.toContain('summary.detail.setSchedule');
        expect(json).not.toContain('summary.detail.editSchedule');
    });

    // personal 区不再重复渲染定时按钮：renderPersonalSummary() 的节点树中
    // 不应再出现 setSchedule/editSchedule 文案。
    it('renderPersonalSummary no longer renders a duplicate schedule button', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: 2, status: 5, permissions: { can_edit: true, can_schedule: true } }),
            personalResult: { worker_status: 2, content: 'my summary', submitted_at: null } as any,
            personalLoading: false,
            scheduleItem: null,
            isEditing: false,
            members: [member('test-uid'), member('u_b')],
        };
        const json = JSON.stringify((page as any).renderPersonalSummary());
        expect(json).not.toContain('summary.detail.setSchedule');
        expect(json).not.toContain('summary.detail.editSchedule');
        // 但仍保留个人级操作：“提交给全部”。
        expect(json).toContain('summary.detail.submitToAll');
    });
});

// ─── m1（隐私收口，第二轮）：他人个人报告折叠态也不得露 [n] 角标 ───
//
// 背景：renderParticipantReports 折叠预览旧实现直接 content.slice(0,100)，
// 前 100 字内的 [1] 仍可见；展开态已清。修复：先算 displayContent = content.replace(/\[\d+\]/g,'')，
// 展开/折叠/截断判断都基于 displayContent。
describe('SummaryDetailPage — m1: 他人报告折叠态不露 [n] 角标', () => {
    beforeEach(() => vi.clearAllMocks());

    const longWithCitation =
        '这是李四的个人总结正文 [1]，后面还有很多内容用来触发折叠预览的截断逻辑，' +
        '继续堆字数让正文超过一百个字符以便进入折叠分支并验证预览里不再出现方括号数字角标，' +
        '再补一点点字防止边界不稳。';

    it('collapsed preview of another member report strips [n] (no [1] leak)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            membersLoading: false,
            expandedReports: {}, // 折叠态
            members: [
                { user_id: 'creator', user_name: 'C', status: 'submitted', submitted_at: '2026-01-01T10:00:00Z', content: 'creator own' },
                { user_id: 'u_b', user_name: '李四', status: 'submitted', submitted_at: '2026-01-01T10:00:00Z', content: longWithCitation },
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 折叠预览里不得出现 [1] 角标。
        expect(json).not.toContain('[1]');
        // 但正文内容仍在（去角标后的文字）。
        expect(json).toContain('这是李四的个人总结正文');
    });

    it('expanded report passes empty citations and stripped content to CitationText', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            membersLoading: false,
            expandedReports: { u_b: true }, // 展开态
            members: [
                { user_id: 'creator', user_name: 'C', status: 'submitted', submitted_at: '2026-01-01T10:00:00Z', content: 'creator own' },
                { user_id: 'u_b', user_name: '李四', status: 'submitted', submitted_at: '2026-01-01T10:00:00Z', content: longWithCitation },
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 展开态 CitationText 的 content 已清 [n]，且 citations 为空数组。
        expect(json).not.toContain('[1]');
        expect(json).toContain('"citations":[]');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 批次B（多人协作详情页 7 点需求）：fail-before / pass-after。
//
// 多人协作 = detail.participants.length>1 且 summary_mode===BY_PERSON。
// 后端 permissions 新增 6 字段：can_edit_team / can_edit_personal / can_view_schedule
//   / can_add_member / can_schedule / can_edit(旧,勿用)。
// 新接口：PUT /summaries/:id/personal-edit {content}；POST /summaries/:id/members {user_ids}。
// ═══════════════════════════════════════════════════════════════════════════

const SM_BY_PERSON = 2;
const SM_BY_GROUP = 1;
const COMPLETED = 3;

// 多人协作 detail：BY_PERSON + 2 participants（含自己 test-uid）。
const multiCollabDetail = (perms: any = {}, over: any = {}) =>
    baseDetail({
        summary_mode: SM_BY_PERSON,
        status: COMPLETED,
        participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }],
        result: { content: 'team content [1]', version: 3, citations: [], team_citations: [], total_msg_count: 9 },
        result_id: 77,
        permissions: {
            can_edit: false,
            can_edit_team: false,
            can_edit_personal: false,
            can_view_schedule: false,
            can_add_member: false,
            can_schedule: false,
            ...perms,
        },
        ...over,
    });

const submittedMember = (uid: string, name: string, content: string) => ({
    user_id: uid, user_name: name, status: 'submitted',
    submitted_at: '2026-06-16T08:00:00Z', content,
});

// ─── 需求1：多人页不显示「我的总结」，单人仍显示 ───
describe('批次B 需求1：多人协作不渲染「我的总结」区块', () => {
    beforeEach(() => vi.clearAllMocks());

    it('isMultiCollab=true for BY_PERSON multi-participant', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), detail: multiCollabDetail() };
        expect((page as any).isMultiCollab()).toBe(true);
    });

    it('isMultiCollab=false for single-person BY_PERSON', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: SM_BY_PERSON, participants: [{ user_id: 'test-uid' }] }),
        };
        expect((page as any).isMultiCollab()).toBe(false);
    });

    it('isMultiCollab=false for BY_GROUP even with many participants', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: SM_BY_GROUP, participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }] }),
        };
        expect((page as any).isMultiCollab()).toBe(false);
    });
});

// ─── 需求2：定时信息只读对全员可见（can_view_schedule）；设置按钮仍仅 creator ───
describe('批次B 需求2：定时信息 gate=can_view_schedule（全员）, 设置按钮 gate=can_schedule（creator）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renderScheduleSummary visible to non-creator participant (can_view_schedule=true, can_schedule=false)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_view_schedule: true, can_schedule: false }),
            scheduleItem: { schedule_id: 5, is_active: true, unit: 'week', every: 1, run_time: '09:00' } as any,
        };
        expect((page as any).renderScheduleSummary()).not.toBeNull();
    });

    it('renderScheduleSummary hidden when can_view_schedule=false', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_view_schedule: false }),
            scheduleItem: { schedule_id: 5, is_active: true } as any,
        };
        expect((page as any).renderScheduleSummary()).toBeNull();
    });

    it('renderScheduleButton (设置) still gated by can_schedule (creator only)', () => {
        const creator = makePage(1);
        creator.state = { ...(creator.state as any), detail: multiCollabDetail({ can_schedule: true }), isEditing: false };
        expect((creator as any).renderScheduleButton()).not.toBeNull();

        const viewer = makePage(1);
        viewer.state = { ...(viewer.state as any), detail: multiCollabDetail({ can_schedule: false, can_view_schedule: true }), isEditing: false };
        expect((viewer as any).renderScheduleButton()).toBeNull();
    });
});

// ─── 需求3：自己报告有编辑按钮、他人没有；点编辑进 editor、保存调 personal-edit ───
describe('批次B 需求3：参与者报告自己那条有编辑（can_edit_personal）, 他人没有, 隐私分别处理', () => {
    beforeEach(() => vi.clearAllMocks());

    it('my own report row shows edit button when can_edit_personal=true; others do not', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: true }),
            membersLoading: false,
            expandedReports: {},
            members: [
                submittedMember('test-uid', '我', 'my own report [2]'),
                submittedMember('u_b', '李四', '李四的报告 [1]'),
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 自己那条出现编辑按钮文案。
        expect(json).toContain('summary.detail.editMyReport');
    });

    it('no edit button when can_edit_personal=false', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: false }),
            membersLoading: false,
            expandedReports: {},
            members: [
                submittedMember('test-uid', '我', 'my own report'),
                submittedMember('u_b', '李四', '李四的报告'),
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        expect(json).not.toContain('summary.detail.editMyReport');
    });

    it("other members' report keeps privacy: [n] stripped + citations=[]; my own NOT stripped", () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: true }),
            membersLoading: false,
            expandedReports: { 'test-uid': true, u_b: true },
            members: [
                { ...submittedMember('test-uid', '我', '我的报告 [5]'), citations: [{ index: 5, sender: 's', content: 'c', sent_at: '', source: '' }] },
                submittedMember('u_b', '李四', '李四的报告 [1]'),
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 他人 [1] 被清；自己 [5] 保留（不被隐私清洗）。
        expect(json).not.toContain('[1]');
        expect(json).toContain('[5]');
    });

    it('clicking edit enters personal SummaryEditor (editingPersonalReport)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: true }),
            membersLoading: false,
            expandedReports: {},
            editingPersonalReport: false,
            members: [submittedMember('test-uid', '我', 'my own report'), submittedMember('u_b', '李四', 'x')],
        };
        // 进入编辑态。
        (page as any).handleStartEditPersonalReport();
        expect((page.state as any).editingPersonalReport).toBe(true);
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 我那条进入 editor：mode=personal 透传（SummaryEditor props 序列化可见）。
        expect(json).toContain('"mode":"personal"');
        expect(json).toContain('my own report'); // initialContent=自己的 content
    });

    it('personal-edit save calls api.personalEditSummary with {content}', async () => {
        vi.mocked(api.personalEditSummary).mockResolvedValue({ edited_at: 'now' } as any);
        // 直接验证 API 形状（SummaryEditor mode=personal 调它）。
        await api.personalEditSummary(1, 'edited content');
        expect(api.personalEditSummary).toHaveBeenCalledWith(1, 'edited content');
    });
});

// ─── 需求4：团队编辑按钮仅 creator（can_edit_team） ───
describe('批次B 需求4：团队总结编辑按钮 gate=can_edit_team（仅 creator）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('team edit button rendered when can_edit_team=true', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: true }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: false,
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).toContain('summary.detail.editTeamSummary');
    });

    it('team edit button NOT rendered for non-creator (can_edit_team=false)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: false }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: false,
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).not.toContain('summary.detail.editTeamSummary');
    });

    it('team edit inline editor uses default (team) mode → editSummary path', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: true }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: true,
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        // team 模式不透传 mode=personal。
        expect(json).not.toContain('"mode":"personal"');
        expect(json).toContain('team content'); // initialContent=团队结果内容
    });
});

// ─── team-summary-gentime：团队总结最终渲染分支展示当前版本生成时间 ───
//
// 根因：团队总结最终渲染分支的 section-header 只展示了「已提交人数」Tag
//   与「版本」Tag，唯独没有展示当前版本的生成时间（single 视图已用
//   summary.detail.generatedAt + formatDate(generated_at) 展示）。
// 修复：复用现有 detail.result.generated_at + summary.detail.generatedAt + formatDate，
//   在团队总结 badge 区「版本」Tag 旁补上生成时间 Tag。
// fail-before：修复前团队分支不含 summary.detail.generatedAt key。
// pass-after：修复后团队分支输出含该 key。
describe('team-summary-gentime：团队总结渲染当前版本生成时间', () => {
    beforeEach(() => vi.clearAllMocks());

    // pass-after 核心：多人 + COMPLETED + 有 result(含 generated_at) → 团队分支渲染 generatedAt 文案。
    it('multi + COMPLETED + result has generated_at → team branch renders generatedAt text', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(
                { can_edit_team: false },
                { result: { content: 'team content [1]', version: 3, citations: [], team_citations: [], total_msg_count: 9, generated_at: '2026-06-16T08:00:00Z' } },
            ),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: false,
        };
        const out = (page as any).renderTeamSummary();
        expect(out).not.toBeNull();
        const json = JSON.stringify(out);
        // 修复前该 key 仅出现在 single/个人视图（本处不渲染），团队分支无。
        expect(json).toContain('summary.detail.generatedAt');
        // 依然与版本 Tag 语义相邻、同区呈现。
        expect(json).toContain('summary.common.version');
        expect(json).toContain('summary.detail.submittedPeople');
    });

    // generated_at 为 null 时与 single 视图一致容错：仍渲染 generatedAt 文案（formatDate(null)->"-"），不报错。
    it('multi + COMPLETED + generated_at=null → still renders generatedAt text (formatDate null-safe, parity with single view)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(
                { can_edit_team: false },
                { result: { content: 'team content', version: 3, citations: [], team_citations: [], total_msg_count: 9, generated_at: null } },
            ),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: false,
        };
        const out = (page as any).renderTeamSummary();
        expect(out).not.toBeNull();
        expect(JSON.stringify(out)).toContain('summary.detail.generatedAt');
    });
});

// ─── 回归修复：定时(scheduled)多人任务团队总结不显示 ───
//
// 根因：renderTeamSummary 旧实现用 `m.status === "submitted"` 统计 submittedCount。
// members[].status 是后端 GetMembers 下发的字符串 label：
//   - 手动多人任务终态 label = "submitted" → 计数成立 → 团队总结显示。
//   - 定时多人任务个人总结完成后参与者置 ParticipantCompleted，label = "completed"
//     → `=== "submitted"` 恒 false → submittedCount=0 → return null → 团队总结被前端跳过。
// 修复：改用与 renderParticipantReports 一致的「实际贡献者」口径 m.submitted_at && m.content，
//       定时(completed)/手动(submitted) 两条路径都能正确计数，空内容成员不计。
const completedMember = (uid: string, name: string, content: string) => ({
    user_id: uid, user_name: name, status: 'completed', // 定时轮次终态 label
    submitted_at: '2026-06-16T08:00:00Z', content,
});

describe('回归修复：定时(scheduled)多人任务团队总结显示（按 submitted_at && content 口径计数）', () => {
    beforeEach(() => vi.clearAllMocks());

    // fail-before / pass-after 核心：成员 status='completed'（定时）但 submitted_at + content 非空、
    // detail.result 有内容 → 团队总结区必须渲染（修复前因 status!=='submitted' 被 return null）。
    it('scheduled multi: members status="completed" with submitted_at & content → renders team summary (not null)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: false }),
            members: [
                completedMember('test-uid', '我', '我的定时报告'),
                completedMember('u_b', '李四', '李四的定时报告'),
            ],
            editingTeamSummary: false,
        };
        const out = (page as any).renderTeamSummary();
        expect(out).not.toBeNull();
        const json = JSON.stringify(out);
        // 团队总结标题 + 「已提交人数」badge（count>0）都出现，证明不再 return null。
        expect(json).toContain('summary.detail.teamSummary');
        expect(json).toContain('summary.detail.submittedPeople');
        // 只要出现只读 content-box（非 null）+ submittedPeople badge 即证明 submittedCount>0、不再 return null。
        expect(json).toContain('summary-detail-content-box');
    });

    // 反向：所有成员 submitted_at=null 或 content 空 → submittedCount=0 → 仍 return null（不放过空内容）。
    it('all members lacking submitted_at/content → submittedCount=0 → team summary still null', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: false }),
            members: [
                { user_id: 'test-uid', user_name: '我', status: 'completed', submitted_at: null, content: '' },
                { user_id: 'u_b', user_name: '李四', status: 'completed', submitted_at: '2026-06-16T08:00:00Z', content: '' },
            ],
            editingTeamSummary: false,
        };
        expect((page as any).renderTeamSummary()).toBeNull();
    });

    // 不回归：手动多人任务 status='submitted' 仍能正常显示团队总结。
    it('manual multi: members status="submitted" still renders team summary (no regression)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: false }),
            members: [
                submittedMember('test-uid', '我', '我的手动报告'),
                submittedMember('u_b', '李四', '李四的手动报告'),
            ],
            editingTeamSummary: false,
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).toContain('summary.detail.teamSummary');
        expect(json).toContain('summary.detail.submittedPeople');
    });
});

// ─── 需求5：定时按钮位置 ───
describe('批次B 需求5：定时按钮位置（多人→团队框, 单人→编辑左侧, 顶部移除）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('top header no longer renders the schedule button', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_schedule: true, can_view_schedule: true }),
            scheduleItem: null,
            isEditing: false,
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            forwardingToMatter: false,
        };
        const json = JSON.stringify((page as any).renderHeader());
        // header 不再含定时按钮文案（schedule summary 只读信息也因 scheduleItem=null 不出）。
        expect(json).not.toContain('summary.detail.setSchedule');
        expect(json).not.toContain('summary.detail.editSchedule');
    });

    it('multi-collab: schedule button rendered inside renderTeamSummary (creator)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_schedule: true, can_edit_team: true }),
            scheduleItem: null,
            isEditing: false,
            editingTeamSummary: false,
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        // 团队框内含定时按钮 + 编辑按钮。
        expect(json).toContain('summary.detail.setSchedule');
        expect(json).toContain('summary.detail.editTeamSummary');
    });

    it('single-person BY_PERSON: schedule button rendered in renderPersonalSummary (left of edit)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({
                summary_mode: SM_BY_PERSON, status: COMPLETED,
                participants: [{ user_id: 'test-uid' }],
                permissions: { can_edit: true, can_schedule: true },
            }),
            personalResult: { worker_status: 2, content: 'my summary', submitted_at: null } as any,
            personalLoading: false,
            scheduleItem: null,
            isEditing: false,
            members: [submittedMember('test-uid', '我', 'a')],
        };
        const json = JSON.stringify((page as any).renderPersonalSummary());
        // 单人个人总结区含定时按钮（在编辑按钮左侧）。
        expect(json).toContain('summary.detail.setSchedule');
        expect(json).toContain('summary.common.edit');
    });

    it('multi-collab: renderPersonalSummary does NOT render schedule button (it lives in team box)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_schedule: true }),
            personalResult: { worker_status: 2, content: 'my summary', submitted_at: null } as any,
            personalLoading: false,
            scheduleItem: null,
            isEditing: false,
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
        };
        const json = JSON.stringify((page as any).renderPersonalSummary());
        expect(json).not.toContain('summary.detail.setSchedule');
        expect(json).not.toContain('summary.detail.editSchedule');
    });
});

// ─── 需求7：加成员按钮仅 creator（can_add_member）+ 调 POST /members ───
describe('批次B 需求7：成员状态区「添加成员」按钮 gate=can_add_member（仅 creator）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('add-member button rendered when can_add_member=true (creator)', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), detail: multiCollabDetail({ can_add_member: true }) };
        const json = JSON.stringify((page as any).renderMemberStatusHeader());
        expect(json).toContain('summary.detail.addMember');
    });

    it('add-member button NOT rendered for non-creator (can_add_member=false)', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), detail: multiCollabDetail({ can_add_member: false }) };
        const json = JSON.stringify((page as any).renderMemberStatusHeader());
        expect(json).not.toContain('summary.detail.addMember');
    });

    it('handleAddMemberConfirm calls api.addMembers with user_ids then loadDetail', async () => {
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(multiCollabDetail({ can_add_member: true }) as any);

        const page = makePage(1);
        page.state = { ...(page.state as any), detail: multiCollabDetail({ can_add_member: true }) };

        await (page as any).handleAddMemberConfirm([{ user_id: 'u_new', name: 'n', avatar: '', department: '' }]);

        expect(api.addMembers).toHaveBeenCalledWith(1, ['u_new']);
        // 成功后 loadDetail 刷新（getSummaryDetail 被再次调用）。
        expect(api.getSummaryDetail).toHaveBeenCalled();
    });

    it('addMembers API posts {user_ids:[...]}', async () => {
        vi.mocked(api.addMembers).mockResolvedValue(undefined as any);
        await api.addMembers(9, ['a', 'b']);
        expect(api.addMembers).toHaveBeenCalledWith(9, ['a', 'b']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 批次B 回炉（reviewer F1/F2）：编辑态互斥 + 切 task 复位 + 编辑分支权限双校验；
// personal-edit body 严格 {content}（不带 base_result_id）。
// ═══════════════════════════════════════════════════════════════════════════
describe('批次B 回炉 F1：编辑态互斥 / 切 task 复位 / 编辑分支权限双校验', () => {
    beforeEach(() => vi.clearAllMocks());

    it('进团队编辑态后个人编辑态/单人编辑态被关闭（互斥）', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), editingPersonalReport: true, isEditing: true, editingTeamSummary: false };
        (page as any).handleStartEditTeam();
        expect((page.state as any).editingTeamSummary).toBe(true);
        expect((page.state as any).editingPersonalReport).toBe(false);
        expect((page.state as any).isEditing).toBe(false);
    });

    it('进个人报告编辑态后团队/单人编辑态被关闭（互斥）', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), editingTeamSummary: true, isEditing: true, editingPersonalReport: false };
        (page as any).handleStartEditPersonalReport();
        expect((page.state as any).editingPersonalReport).toBe(true);
        expect((page.state as any).editingTeamSummary).toBe(false);
        expect((page.state as any).isEditing).toBe(false);
    });

    it('进单人编辑态后团队/个人编辑态被关闭（互斥）', () => {
        const page = makePage(1);
        page.state = { ...(page.state as any), editingTeamSummary: true, editingPersonalReport: true, isEditing: false };
        (page as any).handleStartEdit();
        expect((page.state as any).isEditing).toBe(true);
        expect((page.state as any).editingTeamSummary).toBe(false);
        expect((page.state as any).editingPersonalReport).toBe(false);
    });

    it('loadDetail / 切 task 后三个编辑态全部复位 false', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(multiCollabDetail({ can_edit_team: true }) as any);
        const page = makePage(1);
        page.state = { ...(page.state as any), editingTeamSummary: true, editingPersonalReport: true, isEditing: true };
        await (page as any).loadDetail();
        expect((page.state as any).editingTeamSummary).toBe(false);
        expect((page.state as any).editingPersonalReport).toBe(false);
        expect((page.state as any).isEditing).toBe(false);
    });

    it('关键回归：editingTeamSummary=true 残留 + 非 creator(can_edit_team=false) → renderTeamSummary 不进 editor', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: false }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: true, // 残留态
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        // 不应渲染团队编辑器：内容框正常展示团队结果，而不是 SummaryEditor 的 initialContent 单独节点。
        // 用 content-box（只读视图）存在 + 不进编辑专属布局来判定。
        expect(json).toContain('summary-detail-content-box');
        // 编辑专属分支只渲染标题 span + SummaryEditor，没有 content-box；这里有 content-box 即未进 editor。
    });

    it('关键回归：editingPersonalReport=true 残留 + 非本人可编辑(can_edit_personal=false) → 自己那条不进 editor', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: false }),
            membersLoading: false,
            expandedReports: {},
            editingPersonalReport: true, // 残留态
            members: [submittedMember('test-uid', '我', 'my own report'), submittedMember('u_b', '李四', 'x')],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 权限不足 → 不透传 personal editor（mode=personal 不应出现）。
        expect(json).not.toContain('"mode":"personal"');
    });

    it('creator(can_edit_team=true) + editingTeamSummary=true → renderTeamSummary 进 editor', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: true }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
            editingTeamSummary: true,
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        // 进 editor：team 模式，initialContent=团队内容，且无只读 content-box。
        expect(json).toContain('team content');
        expect(json).not.toContain('summary-detail-content-box');
    });
});

describe('批次B 回炉 F2：personal-edit body 严格 {content}（不带 base_result_id）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('personalEditSummary 仅以 (taskId, content) 调用，无第三参数', async () => {
        vi.mocked(api.personalEditSummary).mockResolvedValue({ edited_at: 'now' } as any);
        await api.personalEditSummary(42, 'only content');
        expect(api.personalEditSummary).toHaveBeenCalledWith(42, 'only content');
        const call = vi.mocked(api.personalEditSummary).mock.calls[0];
        expect(call.length).toBe(2); // 不应有 base_result_id 第三参
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 回归（need1 引入）：多人协作页缺失「提交给全部」按钮 → 个人总结完成后无法提交
// → submitted_at 永远 NULL → meta 完成判定永不满足 → 任务卡 Processing。
//
// 修复：多人页(isMultiCollab)给「我自己」补回轻量提交 bar（renderMySubmitBar），
// 条件 worker_status===2 && !submitted_at && members>1，点击调 submitPersonalResult。
// 不违反 need1：bar 只放一句提示 + 提交按钮，不展开我的总结正文。
// ═══════════════════════════════════════════════════════════════════════════
describe('SummaryDetailPage — 回归修复：多人协作页「提交给全部」入口(renderMySubmitBar)', () => {
    beforeEach(() => vi.clearAllMocks());

    // fail-before / pass-after 核心：多人 + 我个人总结已完成且未提交 → 渲染「提交给全部」按钮。
    it('multi-collab + my personalResult done(worker_status=2) & not submitted & members>1 → renders submit bar', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'my done summary', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        const json = JSON.stringify((page as any).renderMySubmitBar());
        // 「提交给全部」按钮存在。
        expect(json).toContain('summary.detail.submitToAll');
    });

    // 点击「提交给全部」→ 调 api.submitPersonalResult(taskId)。
    it('clicking submit bar button calls api.submitPersonalResult(taskId)', async () => {
        vi.mocked(api.submitPersonalResult).mockResolvedValue(undefined as any);
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'my done summary', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        // handleSubmitPersonal 是按钮的 onClick。
        await (page as any).handleSubmitPersonal();
        expect(api.submitPersonalResult).toHaveBeenCalledWith(1);
    });

    // 已提交（submitted_at 有值）→ 提交 bar 自动消失。
    it('after submitted (submitted_at present) → submit bar disappears (returns null)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'x', submitted_at: '2026-06-16T08:00:00Z' } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        expect((page as any).renderMySubmitBar()).toBeNull();
    });

    // 个人总结尚未完成（worker_status!==2）→ 不显示提交 bar。
    it('personalResult not finished (worker_status!==2) → no submit bar', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 1, content: '', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        expect((page as any).renderMySubmitBar()).toBeNull();
    });

    // 单人 BY_PERSON → 不出现提交 bar（无回归）。
    it('single-person BY_PERSON → no submit bar (isMultiCollab=false)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: SM_BY_PERSON, status: COMPLETED, participants: [{ user_id: 'test-uid' }] }),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid')],
        };
        expect((page as any).renderMySubmitBar()).toBeNull();
    });

    // BY_GROUP（即便多 participants）→ 不出现提交 bar（无回归）。
    it('BY_GROUP with many participants → no submit bar', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ summary_mode: SM_BY_GROUP, status: COMPLETED, participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }] }),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        expect((page as any).renderMySubmitBar()).toBeNull();
    });

    // need1 仍成立：多人页提交 bar 只含提示+按钮，不含「我的总结」正文区块。
    it('need1 preserved: submit bar contains hint + button only, NOT the personal summary body block', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'MY_PERSONAL_BODY_TEXT', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        const json = JSON.stringify((page as any).renderMySubmitBar());
        // 只放提示 + 提交按钮。
        expect(json).toContain('summary.detail.mySubmitHint');
        expect(json).toContain('summary.detail.submitToAll');
        // 绝不展开我的总结正文 → 不含个人总结正文内容、不含 CitationText 内容容器。
        expect(json).not.toContain('MY_PERSONAL_BODY_TEXT');
        expect(json).not.toContain('summary-detail-content-box');
        // 也不渲染「我的总结」标题区。
        expect(json).not.toContain('summary.detail.mySummary');
    });

    // F2：任一编辑态下提交 bar 隐藏（避免与编辑器并存/提交冲突）。
    it('F2: submit bar hidden while any edit state active', () => {
        const baseState = (taskId: number) => ({
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        });
        for (const flag of ['isEditing', 'editingPersonalReport', 'editingTeamSummary']) {
            const page = makePage(1);
            page.state = { ...(page.state as any), ...baseState(1), [flag]: true } as any;
            expect((page as any).renderMySubmitBar()).toBeNull();
        }
        // 非编辑态仍正常显示。
        const page = makePage(1);
        page.state = {
            ...(page.state as any), ...baseState(1),
            isEditing: false, editingPersonalReport: false, editingTeamSummary: false,
        } as any;
        expect((page as any).renderMySubmitBar()).not.toBeNull();
    });

    // F1：提交成功后刷新 detail（最后一人提交后团队总结/状态才能及时出现）。
    it('F1: handleSubmitPersonal refreshes detail (calls getSummaryDetail) after submit', async () => {
        vi.mocked(api.submitPersonalResult).mockResolvedValue(undefined as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(multiCollabDetail() as any);
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        await (page as any).handleSubmitPersonal();
        expect(api.submitPersonalResult).toHaveBeenCalledWith(1);
        expect(api.getSummaryDetail).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 老板新要求（方案甲）：提交入口下放到【参与者报告区】「我自己」那条；
// 同时顶部 renderMySubmitBar 美化成「带框卡片」（含提示 icon）。两处共用门控+提交逻辑。
// 核心硬性：参与者报告部分能看到并点到提交按钮；不违反 need1（不展开我的总结正文）。
// ═══════════════════════════════════════════════════════════════════════════
describe('SummaryDetailPage — 方案甲：参与者报告区「我（待提交）」提交入口 + 顶部卡片美化', () => {
    beforeEach(() => vi.clearAllMocks());

    // 参与者报告区：多人 + 我个人完成且未提交 → 渲染提交按钮（我那条）。
    it('participant reports: multi + my done & not submitted → renders submit button row', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'MY_BODY', submitted_at: null } as any,
            personalLoading: false,
            membersLoading: false,
            expandedReports: {},
            // 我那条：member 视角尚无 submitted_at（getMembers 还没刷出我已提交）。
            members: [member('test-uid'), submittedMember('u_b', '李四', '李四的报告')],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 我那条主提交入口：提交按钮文案 + 「我（待提交）」占位名。
        expect(json).toContain('summary.detail.submitToAll');
        expect(json).toContain('summary.detail.mySubmitRowName');
    });

    // 点击参与者报告区提交按钮（onClick=handleSubmitPersonal）→ 调 submitPersonalResult(taskId)。
    it('participant-reports submit button onClick calls api.submitPersonalResult(taskId)', async () => {
        vi.mocked(api.submitPersonalResult).mockResolvedValue(undefined as any);
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false,
            membersLoading: false,
            expandedReports: {},
            members: [member('test-uid'), submittedMember('u_b', '李四', 'x')],
        };
        // 渲染出我那行（确认入口存在），再调其 onClick 等价逻辑。
        const json = JSON.stringify((page as any).renderParticipantReports());
        expect(json).toContain('summary.detail.submitToAll');
        await (page as any).handleSubmitPersonal();
        expect(api.submitPersonalResult).toHaveBeenCalledWith(1);
    });

    // 老板新要求（覆盖旧 need1）：提交前自己的总结应在参与者报告里能看到正文，
    // 且引用可点（用 CitationText 渲染 personalResult.content/citations）。提交按钮保留。
    it('boss req: my pending row shows my personal body via CitationText (clickable citations) + submit button', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: {
                worker_status: 2,
                content: 'MY_PENDING_BODY [1]',
                submitted_at: null,
                citations: [{ index: 1, sender: 's', content: 'c', sent_at: '', source: '' }],
            } as any,
            personalLoading: false,
            membersLoading: false,
            expandedReports: {},
            members: [member('test-uid'), submittedMember('u_b', '李四', 'x')],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 提交按钮保留。
        expect(json).toContain('summary.detail.submitToAll');
        // 现在展示我的个人总结正文（取 personalResult.content）。
        expect(json).toContain('MY_PENDING_BODY [1]');
        // 正文通过 CitationText 渲染 → 携带 citations（引用可点）。
        expect(json).toContain('"content":"MY_PENDING_BODY [1]"');
        expect(json).toContain('"citations":[{');
    });

    // 已提交 → 参与者报告区不再出现「我（待提交）」主入口（我那条变为已提交报告）。
    it('after submitted → no pending submit row (my entry becomes a submitted report)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'x', submitted_at: '2026-06-16T08:00:00Z' } as any,
            personalLoading: false,
            membersLoading: false,
            expandedReports: {},
            members: [submittedMember('test-uid', '我', '我的报告'), submittedMember('u_b', '李四', 'x')],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 不再出现「我（待提交）」占位行。
        expect(json).not.toContain('summary.detail.mySubmitRowName');
    });

    // 单人/BY_GROUP → 参与者报告区整体 null（shouldShowMySubmit=false 亦不渲染我那行）。
    it('single-person & BY_GROUP → no participant-reports pending submit row', () => {
        // 单人：members<=1 → renderParticipantReports 直接 null。
        const single = makePage(1);
        single.state = {
            ...(single.state as any),
            detail: baseDetail({ summary_mode: SM_BY_PERSON, status: COMPLETED, participants: [{ user_id: 'test-uid' }] }),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false, membersLoading: false, expandedReports: {},
            members: [member('test-uid')],
        };
        expect((single as any).renderParticipantReports()).toBeNull();
        // BY_GROUP（多 participants）→ shouldShowMySubmit=false，不渲染我那行。
        const group = makePage(1);
        group.state = {
            ...(group.state as any),
            detail: baseDetail({ summary_mode: SM_BY_GROUP, status: COMPLETED, participants: [{ user_id: 'test-uid' }, { user_id: 'u_b' }] }),
            personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
            personalLoading: false, membersLoading: false, expandedReports: {},
            members: [member('test-uid'), submittedMember('u_b', '李四', 'x')],
        };
        const json = JSON.stringify((group as any).renderParticipantReports());
        expect(json).not.toContain('summary.detail.mySubmitRowName');
    });

    // 编辑态 → 参与者报告区不出现「我（待提交）」主入口（shouldShowMySubmit=false）。
    it('any edit state → no participant-reports pending submit row', () => {
        for (const flag of ['isEditing', 'editingPersonalReport', 'editingTeamSummary']) {
            const page = makePage(1);
            page.state = {
                ...(page.state as any),
                detail: multiCollabDetail({ can_edit_personal: true }),
                personalResult: { worker_status: 2, content: 'x', submitted_at: null } as any,
                personalLoading: false, membersLoading: false, expandedReports: {},
                members: [member('test-uid'), submittedMember('u_b', '李四', 'x')],
                [flag]: true,
            } as any;
            const json = JSON.stringify((page as any).renderParticipantReports());
            expect(json).not.toContain('summary.detail.mySubmitRowName');
        }
    });

    // 顶部卡片美化：渲染含提示文案 + 提示 icon class，且不含我的总结正文(need1)。
    it('top card: beautified bar has hint + icon class, no personal body (need1)', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            personalResult: { worker_status: 2, content: 'MY_TOP_BODY', submitted_at: null } as any,
            personalLoading: false,
            members: [member('test-uid'), member('u_b')],
        };
        const json = JSON.stringify((page as any).renderMySubmitBar());
        // 卡片：提示文案 + 带框/icon 的美化（icon class 体现 icon 存在）。
        expect(json).toContain('summary.detail.mySubmitHint');
        expect(json).toContain('summary-detail-my-submit-bar');
        expect(json).toContain('summary-detail-my-submit-icon');
        // need1：不展开我的总结正文。
        expect(json).not.toContain('MY_TOP_BODY');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 本轮（问题1+2+3 前端）：参与者报告区
//  - 问题2：submitted 列表把「我」那条置顶（其余保持原相对顺序）。
//  - 问题3：自己那条始终用 CitationText 渲染（带自己的 citations，引用始终可点，
//           不受 expanded/needsTruncate 限制）；他人那条逻辑不变（收口、清 [n]、截断）。
// ═══════════════════════════════════════════════════════════════════════════
describe('SummaryDetailPage — 问题2：参与者报告区「我」那条置顶', () => {
    beforeEach(() => vi.clearAllMocks());

    // 我（test-uid）原本排在 u_b 之后；渲染时必须被移到第一位，u_b 仍在其后。
    it('my submitted report is hoisted to the FIRST position; others keep relative order', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: true }),
            membersLoading: false,
            expandedReports: {},
            // 顺序：u_b 在前、我在后、u_c 最后。
            members: [
                submittedMember('u_b', '李四', '李四的报告 [1]'),
                { ...submittedMember('test-uid', '我', '我的报告 [9]'), citations: [{ index: 9, sender: 's', content: 'c', sent_at: '', source: '' }] },
                submittedMember('u_c', '王五', '王五的报告 [2]'),
            ],
        };
        const reports = (page as any).renderParticipantReports();
        // 取出 submitted 列表的渲染节点（children[1] 是 submittedSorted.map 的数组）。
        const submittedNodes = (reports.props.children as any[])[1] as any[];
        const orderedUids = submittedNodes.map((n: any) => n.key);
        // 我那条排第一。
        expect(orderedUids[0]).toBe('test-uid');
        // 其余保持原相对顺序：u_b 仍在 u_c 之前。
        expect(orderedUids.indexOf('u_b')).toBeLessThan(orderedUids.indexOf('u_c'));
    });
});

describe('SummaryDetailPage — 问题3（前端）：自己那条始终用 CitationText 渲染（引用可点）', () => {
    beforeEach(() => vi.clearAllMocks());

    // 内容 <100 字且未展开：旧实现 isMe 走纯文本切片（[n] 不可点）；
    // 新实现 isMe 始终用 CitationText 且带自己的 citations。
    it('isMe row uses CitationText with its own citations even when short & not expanded', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_personal: true }),
            membersLoading: false,
            expandedReports: {}, // 未展开
            members: [
                { ...submittedMember('test-uid', '我', '短正文 [3]'), citations: [{ index: 3, sender: 's', content: 'c', sent_at: '', source: '' }] },
                submittedMember('u_b', '李四', '李四的报告 [1]'),
            ],
        };
        const json = JSON.stringify((page as any).renderParticipantReports());
        // 自己那条 CitationText 收到自己的 content + 非空 citations（引用可点）。
        expect(json).toContain('"content":"短正文 [3]"');
        expect(json).toContain('"index":3');
        // 自己 [3] 保留（不被隐私清洗）。
        expect(json).toContain('[3]');
        // 他人 [1] 被清（收口逻辑不变）。
    expect(json).not.toContain('[1]');
    });
});

const PROCESSING = 2;

// React 元素树小工具：递归收集所有带某 className（子串匹配）的元素。
function collectByClass(node: any, cls: string, acc: any[] = []): any[] {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
        node.forEach((n) => collectByClass(n, cls, acc));
        return acc;
    }
    const cn = node.props?.className;
    if (typeof cn === 'string' && cn.split(/\s+/).includes(cls)) acc.push(node);
    const children = node.props?.children;
    if (children != null) collectByClass(children, cls, acc);
    return acc;
}
function firstByClass(node: any, cls: string): any {
    return collectByClass(node, cls)[0];
}

// ─── 问题2：accept/reject 成功后广播事件刷新左侧列表 ───
describe('问题2：handleRespondToTask 成功后广播事件（左侧列表刷新）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('accept 成功后 dispatch summary-task-regenerated + summary-status-change（含 taskId）', async () => {
        vi.mocked(api.respondToTask).mockResolvedValue(undefined as any);
        const page = makePage(7);
        // loadDetail 会被调用，给个最小 mock 避免抛错。
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ task_id: 7 }) as any);

        const events: { type: string; taskIds: any }[] = [];
        const handler = (e: any) => events.push({ type: e.type, taskIds: e.detail?.taskIds });
        window.addEventListener('summary-status-change', handler);
        window.addEventListener('summary-task-regenerated', handler);

        await (page as any).handleRespondToTask('accept');

        window.removeEventListener('summary-status-change', handler);
        window.removeEventListener('summary-task-regenerated', handler);

        // fail-before：旧实现只 loadDetail()，不 dispatch 任一事件 → events 为空。
        // pass-after：两个事件都广播，且都带当前 taskId。
        const regen = events.find((e) => e.type === 'summary-task-regenerated');
        const statusChange = events.find((e) => e.type === 'summary-status-change');
        expect(regen).toBeTruthy();
        expect(regen!.taskIds).toEqual([7]);
        expect(statusChange).toBeTruthy();
        expect(statusChange!.taskIds).toEqual([7]);
    });

    it('reject 成功后同样广播（列表能刷掉「待确认」）', async () => {
        vi.mocked(api.respondToTask).mockResolvedValue(undefined as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail({ task_id: 9 }) as any);
        const page = makePage(9);

        const seen: string[] = [];
        const handler = (e: any) => seen.push(e.type);
        window.addEventListener('summary-task-regenerated', handler);
        await (page as any).handleRespondToTask('reject');
        window.removeEventListener('summary-task-regenerated', handler);

        expect(seen).toContain('summary-task-regenerated');
    });

    it('respondToTask 失败时不广播任何刷新事件', async () => {
        vi.mocked(api.respondToTask).mockRejectedValue(new Error('boom'));
        const page = makePage(11);
        const seen: string[] = [];
        const handler = (e: any) => seen.push(e.type);
        window.addEventListener('summary-task-regenerated', handler);
        window.addEventListener('summary-status-change', handler);
        await (page as any).handleRespondToTask('accept');
        window.removeEventListener('summary-task-regenerated', handler);
        window.removeEventListener('summary-status-change', handler);
        expect(seen).toHaveLength(0);
    });
});

// ─── 问题3：报告卡片收起触发点收窄到 header + toggle，正文区不再绑点击 ───
describe('问题3：展开后点正文不收起（onClick 只在 header/toggle）', () => {
    beforeEach(() => vi.clearAllMocks());

    const longContent = '正文'.repeat(80); // >100 字 → needsTruncate=true

    function renderItemsTree() {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            membersLoading: false,
            expandedReports: { u_b: true }, // u_b 已展开（验证展开态下正文区不绑点击）
            members: [
                submittedMember('test-uid', '我', '我的短报告'),
                submittedMember('u_b', '李四', longContent),
            ],
        };
        return (page as any).renderParticipantReports();
    }

    it('外层卡片 item div 不再绑 onClick', () => {
        const tree = renderItemsTree();
        const items = collectByClass(tree, 'summary-detail-participant-report-item');
        expect(items.length).toBeGreaterThan(0);
        items.forEach((it) => expect(it.props.onClick).toBeUndefined());
    });

    it('正文区 content div 不绑 onClick（展开后可选字/点引用）', () => {
        const tree = renderItemsTree();
        const contents = collectByClass(tree, 'summary-detail-participant-report-content');
        expect(contents.length).toBeGreaterThan(0);
        contents.forEach((c) => expect(c.props.onClick).toBeUndefined());
    });

    it('needsTruncate 的 header 行绑 onClick 且带 clickable', () => {
        const tree = renderItemsTree();
        const headers = collectByClass(tree, 'summary-detail-participant-report-header');
        // 找到 u_b（长正文，needsTruncate）那条 header：className 含 clickable。
        const clickableHeader = headers.find(
            (h) => typeof h.props.className === 'string' && h.props.className.includes('clickable'),
        );
        expect(clickableHeader).toBeTruthy();
        expect(typeof clickableHeader.props.onClick).toBe('function');
    });

    it('toggle 行绑 onClick 且带 clickable，点击触发 toggleReport', () => {
        const page = makePage(1);
        const toggleSpy = vi.spyOn(page as any, 'toggleReport');
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            membersLoading: false,
            expandedReports: {},
            members: [
                submittedMember('test-uid', '我', '短'),
                submittedMember('u_b', '李四', longContent),
            ],
        };
        const tree = (page as any).renderParticipantReports();
        const toggle = firstByClass(tree, 'summary-detail-participant-report-toggle');
        expect(toggle).toBeTruthy();
        expect(toggle.props.className).toContain('clickable');
        expect(typeof toggle.props.onClick).toBe('function');
        toggle.props.onClick();
        expect(toggleSpy).toHaveBeenCalledWith('u_b');
    });

    it('短正文（!needsTruncate）的 header 不带 clickable、onClick 是空操作', () => {
        const page = makePage(1);
        const toggleSpy = vi.spyOn(page as any, 'toggleReport');
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail(),
            membersLoading: false,
            expandedReports: {},
            members: [
                submittedMember('test-uid', '我', '短'),
                submittedMember('u_b', '李四', '也很短'),
            ],
        };
        const tree = (page as any).renderParticipantReports();
        const headers = collectByClass(tree, 'summary-detail-participant-report-header');
        headers.forEach((h) => {
            if (typeof h.props.className === 'string') {
                expect(h.props.className).not.toContain('clickable');
            }
            // onClick 存在但因 needsTruncate=false 调用后不触发 toggleReport。
            if (typeof h.props.onClick === 'function') h.props.onClick();
        });
        expect(toggleSpy).not.toHaveBeenCalled();
    });
});

// ─── 问题4：团队总结「生成中」提示 ───
describe('问题4：多人 + PROCESSING 时显示顶部团队生成中提示', () => {
    beforeEach(() => vi.clearAllMocks());

    it('多人 + status=PROCESSING + result 尚未产出 → 显示 teamGenerating', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({}, { status: PROCESSING, result: null }),
            members: [member('test-uid'), member('u_b')],
        };
        // 团队生成中的顶部状态不再由 renderTeamSummary 承担，避免与“上一版团队汇总”混在一起。
        expect((page as any).renderTeamSummary()).toBeNull();
        const json = JSON.stringify((page as any).renderTeamGeneratingStatus());
        expect(json).toContain('summary.detail.teamGenerating');
        expect(json).toContain('summary-detail-team-generating');
        // 仍带「团队总结」标题。
        expect(json).toContain('summary.detail.teamSummary');
    });

    it('多人 + PROCESSING 即使有旧 result 也降级展示上一版团队汇总（重算期）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({}, { status: PROCESSING }), // result 为旧版本
            members: [member('test-uid'), member('u_b')],
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).toContain('summary.detail.previousTeamSummary');
        expect(json).toContain('summary.detail.previousTeamSummaryDesc');
        expect(json).toContain('team content');
    });

    it('单人 + PROCESSING 不显示团队生成中（participants<=1 → null）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: baseDetail({
                summary_mode: SM_BY_PERSON,
                status: PROCESSING,
                participants: [{ user_id: 'test-uid' }],
                result: null,
                result_id: null,
            }),
            members: [member('test-uid')],
        };
        expect((page as any).renderTeamSummary()).toBeNull();
    });

    it('多人 + COMPLETED 走原有「已完成团队总结」分支（不显示生成中）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({}, { status: COMPLETED }),
            members: [submittedMember('test-uid', '我', 'a'), submittedMember('u_b', '李四', 'b')],
        };
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).not.toContain('summary.detail.teamGenerating');
        // 仍渲染已完成团队总结内容。
        expect(json).toContain('team content');
    });

    it('多人 + PROCESSING + editingTeamSummary 不抢编辑态前的生成中提示（生成中优先）', () => {
        const page = makePage(1);
        page.state = {
            ...(page.state as any),
            detail: multiCollabDetail({ can_edit_team: true }, { status: PROCESSING }),
            editingTeamSummary: true,
            members: [member('test-uid'), member('u_b')],
        };
        // 重算期(PROCESSING)应显示上一版团队汇总，而非进入编辑器。
        const json = JSON.stringify((page as any).renderTeamSummary());
        expect(json).toContain('summary.detail.previousTeamSummary');
        expect(json).not.toContain('SummaryEditor');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 问题2（async 守卫）：handleRemoveMember / handleLeaveTask / loadDetail catch
// 切 task 竞态。await 期间切走的迟到响应不得在新 task 上 setState / Toast / 导航。
// fail-before：缺守卫时迟到响应会污染新 task；pass-after：守卫命中提前 return。
// ═══════════════════════════════════════════════════════════════════════════
describe('SummaryDetailPage — 问题2: 切 task 竞态守卫（loadDetail catch / removeMember / leaveTask）', () => {
    beforeEach(() => vi.clearAllMocks());

    // 2a：loadDetail 的 getSummaryDetail 在切 task 后才 reject → 不能把 error/loading 写到新 task。
    it('loadDetail catch discards a late failure after switching task (no stale error on new task)', async () => {
        let rejectA: (e: any) => void = () => {};
        const aPending = new Promise((_res, rej) => { rejectA = rej; });
        vi.mocked(api.getSummaryDetail).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        // 启动 A 的 loadDetail（发起 getSummaryDetail(1)，未 settle）。
        const pending = page.loadDetail();
        expect(api.getSummaryDetail).toHaveBeenCalledWith(1);

        // 切到 task B，并预置 B 的干净状态。
        (page as any).props = { taskId: 2 };
        page.state = { ...(page.state as any), error: null, loading: false };

        // A 的请求现在才迟迟 reject——其 error 必须被丢弃，不污染 B。
        rejectA(new Error('A 任务加载失败'));
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect((page.state as any).error).toBeNull();
        expect((page.state as any).loading).toBe(false);
    });

    // 2b：handleRemoveMember 的 removeMember 在切 task 后才 resolve → 不 Toast.success / 不 loadDetail。
    it('handleRemoveMember discards a late success after switching task (no Toast / no loadDetail)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.removeMember).mockReturnValueOnce(aPending as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail() as any);

        const page = makePage(1);
        const pending = (page as any).handleRemoveMember('u_x');
        expect(api.removeMember).toHaveBeenCalledWith(1, 'u_x');

        // 切到 task B。
        (page as any).props = { taskId: 2 };

        // A 的 removeMember 迟到 resolve——守卫应让它在 Toast/loadDetail 前 return。
        resolveA(undefined);
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect(Toast.success).not.toHaveBeenCalled();
        // loadDetail 不应被触发（getSummaryDetail 不被调用）。
        expect(api.getSummaryDetail).not.toHaveBeenCalled();
    });

    // 2b 反例：taskId 未变时，合法成功路径照常 Toast.success + loadDetail。
    it('handleRemoveMember still toasts + reloads when taskId unchanged (guard not over-firing)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        vi.mocked(api.removeMember).mockResolvedValue(undefined as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(baseDetail() as any);

        const page = makePage(1);
        await (page as any).handleRemoveMember('u_x');

        expect(Toast.success).toHaveBeenCalled();
        expect(api.getSummaryDetail).toHaveBeenCalled();
    });

    // 2c：handleLeaveTask 的 leaveSummary 在切 task 后才 resolve → 不 Toast.success / 不 popToRoot。
    it('handleLeaveTask discards a late success after switching task (no Toast / no popToRoot)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        const WKApp = (await import('@octo/base/src/App')).default as any;
        const popSpy = vi.spyOn(WKApp.routeRight, 'popToRoot');
        let resolveA: (v: any) => void = () => {};
        const aPending = new Promise((res) => { resolveA = res; });
        vi.mocked(api.leaveSummary).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const pending = (page as any).handleLeaveTask();
        expect(api.leaveSummary).toHaveBeenCalledWith(1);

        // 切到 task B。
        (page as any).props = { taskId: 2 };

        resolveA(undefined);
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect(Toast.success).not.toHaveBeenCalled();
        expect(popSpy).not.toHaveBeenCalled();
        popSpy.mockRestore();
    });

    // 2c 反例：taskId 未变时，合法退出路径照常 Toast.success + popToRoot。
    it('handleLeaveTask still toasts + popToRoot when taskId unchanged (guard not over-firing)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        const WKApp = (await import('@octo/base/src/App')).default as any;
        const popSpy = vi.spyOn(WKApp.routeRight, 'popToRoot');
        vi.mocked(api.leaveSummary).mockResolvedValue(undefined as any);

        const page = makePage(1);
        await (page as any).handleLeaveTask();

        expect(Toast.success).toHaveBeenCalled();
        expect(popSpy).toHaveBeenCalled();
        popSpy.mockRestore();
    });

    // 2d：handleRemoveMember 的 removeMember 在切 task 后才 reject → catch 不能在新 task 上弹 Toast.error。
    it('handleRemoveMember discards a late failure after switching task (no Toast.error on new task)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        let rejectA: (e: any) => void = () => {};
        const aPending = new Promise((_res, rej) => { rejectA = rej; });
        vi.mocked(api.removeMember).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const pending = (page as any).handleRemoveMember('u_x');
        expect(api.removeMember).toHaveBeenCalledWith(1, 'u_x');

        // 切到 task B。
        (page as any).props = { taskId: 2 };

        // A 的 removeMember 迟到 reject——catch 守卫应在 Toast.error 前 return。
        rejectA(new Error('A 移除成员失败'));
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect(Toast.error).not.toHaveBeenCalled();
    });

    // 2d 反例：taskId 未变时，失败路径照常 Toast.error（不 over-guard）。
    it('handleRemoveMember still toasts error when taskId unchanged on failure (guard not over-firing)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        vi.mocked(api.removeMember).mockRejectedValue(new Error('boom') as any);

        const page = makePage(1);
        await (page as any).handleRemoveMember('u_x');

        expect(Toast.error).toHaveBeenCalled();
    });

    // 2e：handleLeaveTask 的 leaveSummary 在切 task 后才 reject → catch 不能在新 task 上弹 Toast.error。
    it('handleLeaveTask discards a late failure after switching task (no Toast.error on new task)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        let rejectA: (e: any) => void = () => {};
        const aPending = new Promise((_res, rej) => { rejectA = rej; });
        vi.mocked(api.leaveSummary).mockReturnValueOnce(aPending as any);

        const page = makePage(1);
        const pending = (page as any).handleLeaveTask();
        expect(api.leaveSummary).toHaveBeenCalledWith(1);

        // 切到 task B。
        (page as any).props = { taskId: 2 };

        // A 的 leaveSummary 迟到 reject——catch 守卫应在 Toast.error 前 return。
        rejectA(new Error('A 退出失败'));
        await pending;
        await Promise.resolve();
        await Promise.resolve();

        expect(Toast.error).not.toHaveBeenCalled();
    });

    // 2e 反例：taskId 未变时，失败路径照常 Toast.error（不 over-guard）。
    it('handleLeaveTask still toasts error when taskId unchanged on failure (guard not over-firing)', async () => {
        const { Toast } = await import('@douyinfe/semi-ui');
        vi.mocked(api.leaveSummary).mockRejectedValue(new Error('boom') as any);

        const page = makePage(1);
        await (page as any).handleLeaveTask();

        expect(Toast.error).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 问题3（成员弹窗）：MemberSelectorModal 预排除已有成员 + 防重复提交。
// 直接实例化组件、设 state、调用 render()，遍历返回的 React 元素树断言：
//   3a) excludedUserIds 中的 uid 不出现在候选列表中；
//   3b) confirmLoading=true 时确认 Button loading 且确认/取消 Button disabled。
// fail-before：未加 excludedUserIds 过滤 / 未消费 confirmLoading 时断言不成立。
// ═══════════════════════════════════════════════════════════════════════════
import MemberSelectorModal from '../../components/MemberSelectorModal';

// 递归收集 React 元素树里的所有元素（含 children 及 element 型 props，如 Modal.footer/prefix）。
function collectElements(node: any, acc: any[] = []): any[] {
    if (node == null || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
        node.forEach((n) => collectElements(n, acc));
        return acc;
    }
    if (node.props) {
        acc.push(node);
        // 遍历所有 props 值，element / array 型（children、footer、prefix 等）都下钻。
        Object.keys(node.props).forEach((k) => {
            const v = node.props[k];
            if (v && typeof v === 'object') collectElements(v, acc);
        });
    }
    return acc;
}

function makeModal(props: any) {
    const full = {
        visible: true,
        selected: [],
        onConfirm: () => {},
        onCancel: () => {},
        ...props,
    };
    const modal = new MemberSelectorModal(full as any);
    (modal as any).context = { t: (k: string) => k };
    (modal as any).props = full;
    return modal;
}

const candidate = (uid: string, name: string) => ({ user_id: uid, name, avatar: '', department: '' });

describe('MemberSelectorModal — 问题3a: 预排除已有成员（excludedUserIds 过滤候选）', () => {
    it('filters out excluded user_ids from the candidate list', () => {
        const modal = makeModal({ excludedUserIds: ['u_in'] });
        modal.state = {
            ...(modal.state as any),
            loading: false,
            candidates: [candidate('u_in', '已在'), candidate('u_free', '可加')],
        };
        const tree = (modal as any).render();
        const json = JSON.stringify(tree);
        // 被排除的 uid 不出现，未排除的 uid 仍在。
        expect(json).not.toContain('u_in');
        expect(json).toContain('u_free');
        expect(json).toContain('可加');
        expect(json).not.toContain('已在');
    });

    it('without excludedUserIds, all candidates render (guard not over-filtering)', () => {
        const modal = makeModal({});
        modal.state = {
            ...(modal.state as any),
            loading: false,
            candidates: [candidate('u_in', '已在'), candidate('u_free', '可加')],
        };
        const json = JSON.stringify((modal as any).render());
        expect(json).toContain('u_in');
        expect(json).toContain('u_free');
    });
});

describe('MemberSelectorModal — 问题3b: 防重复提交（confirmLoading 禁用/loading 确认按钮）', () => {
    it('confirmLoading=true → confirm button loading + confirm/cancel disabled', () => {
        const modal = makeModal({ confirmLoading: true });
        modal.state = { ...(modal.state as any), loading: false, candidates: [] };
        const els = collectElements((modal as any).render());
        // 确认按钮：theme==='solid'；取消按钮无 theme。
        const confirmBtn = els.find((e) => e.props && e.props.theme === 'solid' && 'onClick' in e.props);
        expect(confirmBtn).toBeTruthy();
        expect(confirmBtn.props.loading).toBe(true);
        expect(confirmBtn.props.disabled).toBe(true);
        // 至少存在一个 disabled 的取消按钮（无 theme、有 onClick）。
        const cancelBtn = els.find((e) => e.props && e.props.theme === undefined && 'onClick' in e.props && e.props.disabled === true);
        expect(cancelBtn).toBeTruthy();
    });

    it('confirmLoading falsy → confirm button not loading / not disabled (can submit)', () => {
        const modal = makeModal({ confirmLoading: false });
        modal.state = { ...(modal.state as any), loading: false, candidates: [] };
        const els = collectElements((modal as any).render());
        const confirmBtn = els.find((e) => e.props && e.props.theme === 'solid' && 'onClick' in e.props);
        expect(confirmBtn).toBeTruthy();
        expect(confirmBtn.props.loading).toBeFalsy();
        expect(confirmBtn.props.disabled).toBeFalsy();
    });
});

// ─── 深链 /s/:taskNo：loadPersonalResult 的四个入口在字符串 taskNo 场景下都以数字 task_id 生效 ───
// 背景：/s/:taskNo 深链传入的是字符串 task_no。首载 (loadDetail) 拿到 detail 后，this.taskId
// 回填为 detail.task_id（数字）。此后 handleSubmitPersonal / handleStatusChangeEvent /
// doFallbackPollOnce 三个入口都基于 this.taskId（=数字）驱动 loadPersonalResult，
// 不得再把字符串 task_no 传给 getPersonalResult/getMembers/batchStatus 等数字接口。
describe('SummaryDetailPage — 深链 string taskNo：loadPersonalResult 四入口均以数字 task_id 生效', () => {
    beforeEach(() => vi.clearAllMocks());

    // 入口1：loadDetail（首载）——字符串 taskNo，detail 已提交后 this.taskId=数字。
    it('入口1 loadDetail: string taskNo 首载后 this.taskId 回填为数字 detail.task_id', async () => {
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2 }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: 'r', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid')] as any);

        const page = makePage('SUM-740'); // 同步提交型 setState：detail 落地后 taskId=740
        await page.loadDetail();

        expect(api.getSummaryDetail).toHaveBeenCalledWith('SUM-740'); // 首载用字符串深链标识
        expect(api.getPersonalResult).toHaveBeenCalledWith(740);      // 二次加载用数字
        expect(api.getMembers).toHaveBeenCalledWith(740);
        expect(page.taskId).toBe(740);
    });

    // 入口2：handleSubmitPersonal——提交个人报告后刷新，必须用数字 taskId。
    it('入口2 handleSubmitPersonal: 用数字 task_id 提交并刷新 personalResult/members', async () => {
        vi.mocked(api.submitPersonalResult).mockResolvedValue(undefined as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2 }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: 'r', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid')] as any);

        const page = makePage('SUM-740');
        // 模拟深链首载已完成：detail 已就位，this.taskId=740。
        page.state = { ...(page.state as any), detail: baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2 }) };

        await page.handleSubmitPersonal();

        expect(api.submitPersonalResult).toHaveBeenCalledWith(740);
        expect(api.getPersonalResult).toHaveBeenCalledWith(740);
        expect(api.getMembers).toHaveBeenCalledWith(740);
        // 绝不把字符串 task_no 传给数字接口
        expect(api.submitPersonalResult).not.toHaveBeenCalledWith('SUM-740');
        expect(api.getPersonalResult).not.toHaveBeenCalledWith('SUM-740');
    });

    // 入口3：handleStatusChangeEvent——状态变更事件（携数字 taskIds）触发刷新。
    it('入口3 handleStatusChangeEvent: 数字 taskIds 命中当前深链 task 时刷新 personalResult', async () => {
        // 事件前状态 processing，事件后 completed → 触发终态刷新分支。
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2, status: 5 /* COMPLETED */ }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: 'r', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid')] as any);

        const page = makePage('SUM-740');
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2, status: 2 /* PROCESSING */ }),
            lastKnownStatus: 2,
        };

        // 事件 detail.taskIds 是数字 task_id；this.taskId 必须解析为 740 才能命中。
        await (page as any).handleStatusChangeEvent(
            new CustomEvent('summary-status-change', { detail: { taskIds: [740] } }),
        );

        expect(api.getSummaryDetail).toHaveBeenCalledWith(740);
        expect(api.getPersonalResult).toHaveBeenCalledWith(740);
        expect(api.getPersonalResult).not.toHaveBeenCalledWith('SUM-740');
    });

    // 入口4：doFallbackPollOnce——兜底轮询，batchStatus 用数字 id，终态触发刷新。
    it('入口4 doFallbackPollOnce: batchStatus 用数字 id，终态刷新 personalResult 用数字', async () => {
        vi.mocked(api.batchStatus).mockResolvedValue([{ id: 740, status: 5 /* COMPLETED */ }] as any);
        vi.mocked(api.getSummaryDetail).mockResolvedValue(
            baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2, status: 5 }) as any,
        );
        vi.mocked(api.getPersonalResult).mockResolvedValue(
            { content: 'r', worker_status: 2, submitted_at: null } as any,
        );
        vi.mocked(api.getMembers).mockResolvedValue([member('test-uid')] as any);

        const page = makePage('SUM-740');
        page.state = {
            ...(page.state as any),
            detail: baseDetail({ task_id: 740, task_no: 'SUM-740', summary_mode: 2, status: 2 /* PROCESSING */ }),
            lastKnownStatus: 2,
        };

        await (page as any).doFallbackPollOnce();

        expect(api.batchStatus).toHaveBeenCalledWith([740]);        // 轮询用数字
        expect(api.getPersonalResult).toHaveBeenCalledWith(740);    // 终态刷新用数字
        expect(api.batchStatus).not.toHaveBeenCalledWith(['SUM-740']);
        expect(api.getPersonalResult).not.toHaveBeenCalledWith('SUM-740');
    });
});
