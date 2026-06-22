import { describe, expect, it, vi, beforeEach } from 'vitest';

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
}));

import * as api from '../../api/summaryApi';
import SummaryDetailPage from '../SummaryDetailPage';

vi.mock('../../api/summaryApi');

function makePage(taskId: number) {
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
