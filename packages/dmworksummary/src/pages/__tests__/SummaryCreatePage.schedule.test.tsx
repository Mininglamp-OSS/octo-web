import { describe, expect, it, vi, beforeEach } from 'vitest';

// SummaryCreatePage 间接 import 了 SummaryDetailPage，后者 import wukongimjssdk，
// 该包在测试环境下会拉起 tiptap 等无关依赖导致解析失败。这里 mock 掉它。
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
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
        SplitButtonGroup: Passthrough,
        Dropdown,
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
    IconUserGroup: () => null,
    IconChevronDown: () => null,
}));

import WKApp from '@octo/base/src/App';
import * as api from '../../api/summaryApi';
import SummaryCreatePage from '../SummaryCreatePage';

// 回归测试：创建智能总结时若配置了定时，必须用「一步式」createSchedule —— 参数
// 里直接带 scope='task' + task_id。后端 create 在 scope=task 时已在一个事务里原子
// 完成「建定时 + 绑定 summary_task.schedule_id」，不再需要第二步 updateSchedule，
// 也不会产生游离定时（孤儿），所以不再有 B2 回滚逻辑。
vi.mock('../../api/summaryApi');

describe('SummaryCreatePage — schedule binding on create', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 防止页面跳转逻辑因 mock WKApp 缺少 popToRoot 而抛错。
        (WKApp as any).routeRight = { popToRoot: vi.fn(), push: vi.fn() };
    });

    function makePage() {
        const page = new SummaryCreatePage({});
        // 注入 i18n context（class component contextType）。
        (page as any).context = { t: (k: string) => k };
        // 替换 setState，避免真实 React 生命周期。
        (page as any).setState = function (this: any, patch: any) {
            this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
        };
        // 初始化必要 state。
        page.state = {
            ...(page.state as any),
            topic: '周报总结',
            selectedChats: [],
            selectedMembers: [],
            scheduleConfig: { unit: 'week', every: 1, time: '09:00' },
        } as any;
        return page;
    }

    it('one-step createSchedule with scope=task + task_id (no second-step updateSchedule)', async () => {
        const TASK_ID = 4242;
        const SCHEDULE_ID = 777;

        vi.mocked(api.createSummary).mockResolvedValue({ task_id: TASK_ID });
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: SCHEDULE_ID } as any);

        const page = makePage();
        await page.handleSubmit();

        // 1. 先建 summary。
        expect(api.createSummary).toHaveBeenCalledTimes(1);
        // 2. 一步式建 schedule：参数里直接带 scope='task' + task_id。
        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        expect(api.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: TASK_ID }),
        );
        // 3. 不再有第二步 updateSchedule 绑定。
        expect(api.updateSchedule).not.toHaveBeenCalled();
    });

    it('on schedule create failure: only Toast.error (no rollback / no deleteSchedule)', async () => {
        const TASK_ID = 4242;

        vi.mocked(api.createSummary).mockResolvedValue({ task_id: TASK_ID });
        // 后端原子建绑失败（如一对一约束 / 无权限 / scope=task 缺 task_id）。
        vi.mocked(api.createSchedule).mockRejectedValue(new Error('一对一约束'));

        const { Toast } = await import('@douyinfe/semi-ui');

        const page = makePage();
        await page.handleSubmit();

        // 一步式失败：后端事务回滚，前端不再产生游离定时，因此不应调用 deleteSchedule。
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        // 不再有第二步绑定。
        expect(api.updateSchedule).not.toHaveBeenCalled();
        // 直接透出后端 message。
        expect(Toast.error).toHaveBeenCalled();
        // 总结本身仍创建成功（create.success 仍会展示）。
    });

    it('does not call createSchedule when no schedule configured', async () => {
        vi.mocked(api.createSummary).mockResolvedValue({ task_id: 1 });

        const page = makePage();
        page.state = { ...(page.state as any), scheduleConfig: null } as any;
        await page.handleSubmit();

        expect(api.createSummary).toHaveBeenCalledTimes(1);
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
    });
});
