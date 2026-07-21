import { describe, expect, it, vi, beforeEach } from 'vitest';

// 骨架对齐同目录 ScheduleListPage.confirm.test.tsx：mock 掉重依赖，直接手工实例化 ScheduleListPage 调 handleUpdate。
// 本测试锁 OCT-123 契约（upstream #143 前端部分）：编辑定时任务保存时，
//   1) params.sources 必须原样透传到 api.updateSchedule 的 payload —— 后续任何回落旧值/丢字段的回归都要被拦住；
//   2) sources 元素不能带 source_name —— 后端按 source_id 现查 IM 权威群名，前端不许自作主张补 name。
// 走 ScheduleListPage → 编辑定时主路径（列表页编辑弹窗），OCT-128 的卡片就地改来源(handleSaveSources)是另一条路径，不在本文件范围。
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
        Button: Passthrough,
        Spin: Passthrough,
        Modal: Passthrough,
        Switch: Passthrough,
        Popconfirm: Passthrough,
        Tag: Passthrough,
        Banner: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconArrowLeft: () => null,
    IconPlus: () => null,
    IconDelete: () => null,
    IconEdit: () => null,
}));
vi.mock('../../components/ScheduleForm', () => ({ default: () => null }));

import * as api from '../../api/summaryApi';
import ScheduleListPage from '../ScheduleListPage';
import { SourceType } from '../../types/summary';

vi.mock('../../api/summaryApi');

function makePage() {
    const page = new ScheduleListPage({} as any);
    (page as any).context = { t: (k: string) => k };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

// 单人 schedule：避开 confirm_policy 分支，让本测试只观察 sources 字段。
const editingSchedule = {
    schedule_id: 42,
    participants: [{ user_id: 'solo' }],
    confirm_policy: undefined,
    sources: [{ source_type: SourceType.GROUP_CHAT, source_id: 'old-group', source_name: 'old-group-name' }],
} as any;

const newSources = [
    { source_type: SourceType.GROUP_CHAT, source_id: 'new-group', source_name: 'new-group-name' },
    { source_type: SourceType.THREAD, source_id: 'new-channel', source_name: 'new-channel-name' },
];

const paramsWithNewSources = () => ({
    title: 't',
    summary_mode: 1,
    cron_expr: '',
    interval_days: 1,
    interval_months: 0,
    day_of_week: 0,
    day_of_month: 0,
    run_time: '09:00',
    time_range_type: 2,
    // ScheduleForm 提交前已 strip source_name，这里模拟表单出参形状。
    sources: newSources.map(({ source_type, source_id }) => ({ source_type, source_id })),
});

describe('ScheduleListPage.handleUpdate — OCT-123 编辑定时改「消息来源」契约', () => {
    beforeEach(() => vi.clearAllMocks());

    it('把用户新选的 sources 透传给 api.updateSchedule（不落回旧值）', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({} as any);
        const page = makePage();
        page.state = { ...(page.state as any), editingSchedule };

        await page.handleUpdate(paramsWithNewSources() as any);

        const expectedSources = newSources.map(({ source_type, source_id }) => ({ source_type, source_id }));
        expect(api.updateSchedule).toHaveBeenCalledTimes(1);
        expect(api.updateSchedule).toHaveBeenCalledWith(
            42,
            expect.objectContaining({ sources: expectedSources }),
        );
    });

    it('PUT payload 里 sources 元素不带 source_name（后端权威）', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({} as any);
        const page = makePage();
        page.state = { ...(page.state as any), editingSchedule };

        await page.handleUpdate(paramsWithNewSources() as any);

        const putSources = (vi.mocked(api.updateSchedule).mock.calls[0][1] as any).sources as any[];
        const cleanSources = newSources.map(({ source_type, source_id }) => ({ source_type, source_id }));
        expect(putSources).toEqual(cleanSources);
        putSources.forEach((s) => {
            expect('source_name' in s).toBe(false);
        });
    });
});
