import { describe, expect, it, vi, beforeEach } from 'vitest';

// 与同目录 ScheduleListPage.confirm.test.tsx 对齐：mock 掉重依赖，只测 handleSaveSources 的纯逻辑。
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
vi.mock('../../components/SourceSelector', () => ({ default: () => null }));

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

const src = (id: string) => ({ source_type: 1 as const, source_id: id, source_name: `chat-${id}` });

describe('ScheduleListPage.handleSaveSources — 来源就地编辑', () => {
    beforeEach(() => vi.clearAllMocks());

    it('只 PUT sources 字段，不带其它', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 11, sources: [src('g1')] } as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            schedules: [{ schedule_id: 11, sources: [src('g0')] } as any],
            editingSourcesId: 11,
            editingSourcesDraft: [src('g1')],
        };

        await page.handleSaveSources();

        expect(api.updateSchedule).toHaveBeenCalledTimes(1);
        const [id, payload] = vi.mocked(api.updateSchedule).mock.calls[0];
        expect(id).toBe(11);
        expect(payload).toEqual({ sources: [src('g1')] });
        expect(Object.keys(payload as any)).toEqual(['sources']);
    });

    it('保存成功后立即本地刷新对应卡片的 sources 并关闭弹窗', async () => {
        const updated = { schedule_id: 12, sources: [src('g2')], title: 'from-backend' };
        vi.mocked(api.updateSchedule).mockResolvedValue(updated as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            schedules: [
                { schedule_id: 12, sources: [src('old')], title: 'local' } as any,
                { schedule_id: 99, sources: [src('other')] } as any,
            ],
            editingSourcesId: 12,
            editingSourcesDraft: [src('g2')],
        };

        await page.handleSaveSources();

        const s = (page.state as any).schedules;
        expect(s[0].sources).toEqual([src('g2')]);
        expect(s[0].title).toBe('from-backend'); // 后端返回覆盖本地
        expect(s[1].sources).toEqual([src('other')]); // 其它卡片不受影响
        expect((page.state as any).editingSourcesId).toBeNull();
        expect((page.state as any).editingSourcesDraft).toEqual([]);
        expect((page.state as any).sourcesSaving).toBe(false);
    });

    it('空来源不发请求，提示 sourceRequired', async () => {
        const page = makePage();
        page.state = {
            ...(page.state as any),
            editingSourcesId: 13,
            editingSourcesDraft: [],
        };

        await page.handleSaveSources();

        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect((page.state as any).editingSourcesId).toBe(13); // 弹窗仍保持打开
    });

    it('后端未返回 sources 时回落用户草稿，卡片仍能刷新', async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 14 } as any);
        const page = makePage();
        page.state = {
            ...(page.state as any),
            schedules: [{ schedule_id: 14, sources: [src('old')] } as any],
            editingSourcesId: 14,
            editingSourcesDraft: [src('draft')],
        };

        await page.handleSaveSources();

        expect((page.state as any).schedules[0].sources).toEqual([src('draft')]);
    });

    it('后端错误时 toast 报错、保留弹窗和 draft 供重试', async () => {
        vi.mocked(api.updateSchedule).mockRejectedValue(new Error('boom'));
        const page = makePage();
        page.state = {
            ...(page.state as any),
            schedules: [{ schedule_id: 15, sources: [src('old')] } as any],
            editingSourcesId: 15,
            editingSourcesDraft: [src('draft')],
        };

        await page.handleSaveSources();

        expect((page.state as any).editingSourcesId).toBe(15);
        expect((page.state as any).editingSourcesDraft).toEqual([src('draft')]);
        expect((page.state as any).sourcesSaving).toBe(false);
        // 原卡片 sources 未被修改
        expect((page.state as any).schedules[0].sources).toEqual([src('old')]);
    });
});

describe('ScheduleListPage.openSourcesEditor — 打开卡片来源编辑', () => {
    it('以副本装入 draft，避免直接引用列表里的 sources', () => {
        const page = makePage();
        const listSources = [src('g0')];
        page.openSourcesEditor({ schedule_id: 20, sources: listSources } as any);
        const draft = (page.state as any).editingSourcesDraft;
        expect(draft).toEqual(listSources);
        expect(draft).not.toBe(listSources);
        expect((page.state as any).editingSourcesId).toBe(20);
    });
});
