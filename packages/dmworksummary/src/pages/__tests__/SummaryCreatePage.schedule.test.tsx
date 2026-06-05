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
    return {
        Button: Passthrough,
        Typography,
        Tag: Passthrough,
        Avatar: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
}));

import WKApp from '@octo/base/src/App';
import * as api from '../../api/summaryApi';
import SummaryCreatePage from '../SummaryCreatePage';

// 回归测试：创建智能总结时若配置了定时，必须先 createSchedule，再用刚创建的
// task_id 调 updateSchedule(scope='task', task_id) 把定时绑定到该 task，
// 否则 task.schedule_id 为 NULL、定时成孤儿、详情页不显示。
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

    it('creates schedule then binds it to the new task via updateSchedule(scope=task)', async () => {
        const TASK_ID = 4242;
        const SCHEDULE_ID = 777;

        vi.mocked(api.createSummary).mockResolvedValue({ task_id: TASK_ID });
        vi.mocked(api.createSchedule).mockResolvedValue({ schedule_id: SCHEDULE_ID } as any);
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: SCHEDULE_ID } as any);

        const page = makePage();
        await page.handleSubmit();

        // 1. 先建 summary。
        expect(api.createSummary).toHaveBeenCalledTimes(1);
        // 2. 再建 schedule。
        expect(api.createSchedule).toHaveBeenCalledTimes(1);
        // 3. 关键：用新 task_id 绑定刚建的 schedule。
        expect(api.updateSchedule).toHaveBeenCalledTimes(1);
        expect(api.updateSchedule).toHaveBeenCalledWith(
            SCHEDULE_ID,
            expect.objectContaining({ scope: 'task', task_id: TASK_ID }),
        );

        // 调用顺序：createSchedule 必须在 updateSchedule 之前。
        const createOrder = vi.mocked(api.createSchedule).mock.invocationCallOrder[0];
        const bindOrder = vi.mocked(api.updateSchedule).mock.invocationCallOrder[0];
        expect(createOrder).toBeLessThan(bindOrder);
    });

    it('does not call createSchedule/updateSchedule when no schedule configured', async () => {
        vi.mocked(api.createSummary).mockResolvedValue({ task_id: 1 });

        const page = makePage();
        page.state = { ...(page.state as any), scheduleConfig: null } as any;
        await page.handleSubmit();

        expect(api.createSummary).toHaveBeenCalledTimes(1);
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
    });
});
