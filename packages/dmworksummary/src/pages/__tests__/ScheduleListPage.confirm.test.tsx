import { describe, expect, it, vi, beforeEach } from 'vitest';

// 与 SummaryDetailPage 测试一致：mock 掉会拉起无关重依赖的模块，只测纯逻辑。
vi.mock('wukongimjssdk', () => ({
    Channel: class {},
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));
vi.mock('@douyinfe/semi-ui', () => {
    const Passthrough = ({ children }: any) => children ?? null;
    return {
        Spin: Passthrough,
        Modal: Passthrough,
        Popconfirm: Passthrough,
        Tag: Passthrough,
        Banner: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@octo/ui', () => {
    const Passthrough = ({ children }: any) => children ?? null;
    return {
        Button: Passthrough,
        Switch: Passthrough,
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconArrowLeft: () => null,
    IconPlus: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
}));
// ScheduleForm 拉表单重依赖，对本逻辑无关，mock 成空组件。
vi.mock('../../components/ScheduleForm', () => ({ default: () => null }));

import * as api from '../../api/summaryApi';
import ScheduleListPage from '../ScheduleListPage';

vi.mock('../../api/summaryApi');

function makePage() {
    const page = new ScheduleListPage({} as any);
    (page as any).context = { t: (k: string) => k };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

// handleUpdate(params) 取 this.state.editingSchedule 作为「多人」判定数据源
// （editingSchedule.participants 是后端透出的参与人名单）。
const baseParams = () => ({
    title: 't',
    summary_mode: 1,
    cron_expr: '',
    interval_days: 1,
    interval_months: 0,
    day_of_week: 0,
    day_of_month: 0,
    run_time: '09:00',
    time_range_type: 2,
    sources: [],
});

describe('ScheduleListPage.handleUpdate — V5 confirm_policy passthrough', () => {
    beforeEach(() => vi.clearAllMocks());

    it('multi-person schedule with existing confirm_policy → preserves/passes it through', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({} as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            editingSchedule: {
                schedule_id: 5,
                participants: [{ user_id: 'a' }, { user_id: 'b' }], // 多人
                confirm_policy: 1,
            } as any,
        };

        await page.handleUpdate(baseParams() as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            5,
            expect.objectContaining({ confirm_policy: 1 }),
        );
    });

    it('multi-person schedule missing confirm_policy → defaults to 1', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({} as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            editingSchedule: {
                schedule_id: 6,
                participants: [{ user_id: 'a' }, { user_id: 'b' }],
                // confirm_policy 缺省
            } as any,
        };

        await page.handleUpdate(baseParams() as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            6,
            expect.objectContaining({ confirm_policy: 1 }),
        );
    });

    it('single-person schedule → omits confirm_policy (backend fallback)', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({} as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            editingSchedule: {
                schedule_id: 7,
                participants: [{ user_id: 'a' }], // 单人
            } as any,
        };

        await page.handleUpdate(baseParams() as any);

        const arg = vi.mocked(api.updateSchedule).mock.calls[0][1] as any;
        expect('confirm_policy' in arg).toBe(false);
    });
});
