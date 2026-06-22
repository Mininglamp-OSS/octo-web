import { describe, expect, it, vi, beforeEach } from 'vitest';

// ChatSummaryNewModal 间接 import 的链路里含 wukongimjssdk / semi-ui，
// 在测试环境会拉起无关重依赖，这里与 SummaryCreatePage.schedule.test 一致地 mock 掉。
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
        Modal: Passthrough,
        Button: Passthrough,
        Tag: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => null,
    IconClock: () => null,
}));

// 与现有 ChatSummaryNewModal.test.tsx 一致：mock 掉 channelType，绕过 @octo/base 的
// parseThreadChannelId（依赖 wukongimjssdk 运行时），单测只关心 schedule 绑定逻辑。
vi.mock('../../utils/channelType', () => ({
    getSourceType: () => 2,
}));

import * as summaryApi from '../../api/summaryApi';
import ChatSummaryNewModal from '../ChatSummaryNewModal';

// 回归测试：聊天框右上角入口的「新建智能总结」弹窗，配置了定时后必须仿照完整页，
// 用「一步式」createSchedule —— 参数直接带 scope='task' + task_id，由后端在一个
// 事务里原子完成「建定时 + 绑定 summary_task.schedule_id」。
vi.mock('../../api/summaryApi');

describe('ChatSummaryNewModal — schedule binding on create', () => {
    const channel = { channelID: 'g123', channelType: 2 };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeModal(scheduleConfig: any) {
        const onSubmit = vi.fn();
        const modal = new ChatSummaryNewModal({
            visible: true,
            channel,
            onClose: vi.fn(),
            onSubmit,
        });
        (modal as any).context = { t: (k: string) => k };
        (modal as any).setState = function (this: any, patch: any) {
            this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
        };
        modal.state = {
            ...(modal.state as any),
            topic: '群聊总结',
            selectedChats: [],
            scheduleConfig,
            submitting: false,
        } as any;
        return { modal, onSubmit };
    }

    it('one-step createSchedule with scope=task + task_id when schedule configured', async () => {
        const TASK_ID = 9001;
        vi.mocked(summaryApi.createSummary).mockResolvedValue({ task_id: TASK_ID } as any);
        vi.mocked(summaryApi.createSchedule).mockResolvedValue({ schedule_id: 5 } as any);

        const { modal, onSubmit } = makeModal({ unit: 'week', every: 1, time: '09:00' });
        await (modal as any).handleSubmit();

        expect(summaryApi.createSummary).toHaveBeenCalledTimes(1);
        expect(summaryApi.createSchedule).toHaveBeenCalledTimes(1);
        expect(summaryApi.createSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ scope: 'task', task_id: TASK_ID }),
        );
        // 成功后仍回调 onSubmit，照常进入详情。
        expect(onSubmit).toHaveBeenCalledWith(TASK_ID);
    });

    it('does not call createSchedule when no schedule configured', async () => {
        vi.mocked(summaryApi.createSummary).mockResolvedValue({ task_id: 1 } as any);

        const { modal } = makeModal(null);
        await (modal as any).handleSubmit();

        expect(summaryApi.createSummary).toHaveBeenCalledTimes(1);
        expect(summaryApi.createSchedule).not.toHaveBeenCalled();
    });

    it('on schedule create failure (Error):透出后端 message, 主流程不阻断 onSubmit 仍调用', async () => {
        const TASK_ID = 9002;
        vi.mocked(summaryApi.createSummary).mockResolvedValue({ task_id: TASK_ID } as any);
        vi.mocked(summaryApi.createSchedule).mockRejectedValue(new Error('一对一约束'));

        const { Toast } = await import('@douyinfe/semi-ui');
        const { modal, onSubmit } = makeModal({ unit: 'week', every: 1, time: '09:00' });
        await (modal as any).handleSubmit();

        expect(Toast.error).toHaveBeenCalledWith('一对一约束');
        // 总结本身已创建成功，不因定时失败而阻断主流程。
        expect(onSubmit).toHaveBeenCalledWith(TASK_ID);
    });

    it('on schedule create failure (无 message): 回落到 i18n scheduleFailed 文案', async () => {
        const TASK_ID = 9003;
        vi.mocked(summaryApi.createSummary).mockResolvedValue({ task_id: TASK_ID } as any);
        // 后端抛出非标准 Error（无 message），应回落 i18n key。
        vi.mocked(summaryApi.createSchedule).mockRejectedValue({});

        const { Toast } = await import('@douyinfe/semi-ui');
        const { modal, onSubmit } = makeModal({ unit: 'week', every: 1, time: '09:00' });
        await (modal as any).handleSubmit();

        // context.t 在测试里被注入为 (k) => k，故回落值即 key 本身。
        expect(Toast.error).toHaveBeenCalledWith('summary.create.scheduleFailed');
        expect(onSubmit).toHaveBeenCalledWith(TASK_ID);
    });
});
