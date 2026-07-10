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
            schedules: [{ schedule_id: 11, sources: [src('g0')], creator_id: 'test-uid' } as any],
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
                { schedule_id: 12, sources: [src('old')], title: 'local', creator_id: 'test-uid' } as any,
                { schedule_id: 99, sources: [src('other')], creator_id: 'test-uid' } as any,
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
            schedules: [{ schedule_id: 14, sources: [src('old')], creator_id: 'test-uid' } as any],
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
            schedules: [{ schedule_id: 15, sources: [src('old')], creator_id: 'test-uid' } as any],
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
        page.openSourcesEditor({ schedule_id: 20, sources: listSources, creator_id: 'test-uid' } as any);
        const draft = (page.state as any).editingSourcesDraft;
        expect(draft).toEqual(listSources);
        expect(draft).not.toBe(listSources);
        expect((page.state as any).editingSourcesId).toBe(20);
    });
});

// 权限判定 (OCT-128)：只有 creator 才展示「编辑来源」入口。creator_id 缺失（旧后端）
// 按 fail-closed 处理不展示，配合后端 403 兜底做双层防御。
// 直接调 render() 遍历树，靠 aria-label 定位那颗按钮。
describe('ScheduleListPage — 编辑来源按钮 creator 权限判定 (fail-closed)', () => {
    function collectElements(node: any, acc: any[] = []): any[] {
        if (node == null || typeof node !== 'object') return acc;
        if (Array.isArray(node)) { node.forEach((n) => collectElements(n, acc)); return acc; }
        if (node.props) {
            acc.push(node);
            Object.keys(node.props).forEach((k) => {
                const v = node.props[k];
                if (v && typeof v === 'object') collectElements(v, acc);
            });
        }
        return acc;
    }

    // aria-label='summary.schedule.editSourcesTitle'（context.t = (k)=>k，返回原 key）
    // 是那颗按钮的唯一标识；卡片操作栏那颗铅笔（打开完整 editModal）没有 aria-label。
    function editSourcesButtons(page: any) {
        return collectElements(page.render()).filter(
            (e) => e.props && e.props['aria-label'] === 'summary.schedule.editSourcesTitle',
        );
    }

    function pageWithSchedules(schedules: any[]) {
        const page = makePage();
        page.state = { ...(page.state as any), loading: false, schedules };
        return page;
    }

    it('creator（creator_id === loginInfo.uid）→ 按钮渲染', () => {
        const page = pageWithSchedules([{ schedule_id: 1, sources: [src('g0')], creator_id: 'test-uid', cron_expr: '0 9 * * 1' } as any]);
        expect(editSourcesButtons(page)).toHaveLength(1);
    });

    it('非 creator（creator_id 属于他人）→ 按钮不渲染', () => {
        const page = pageWithSchedules([{ schedule_id: 2, sources: [src('g0')], creator_id: 'someone-else', cron_expr: '0 9 * * 1' } as any]);
        expect(editSourcesButtons(page)).toHaveLength(0);
    });

    it('creator_id undefined（旧后端未透出）→ fail-closed 按钮不渲染', () => {
        const page = pageWithSchedules([{ schedule_id: 3, sources: [src('g0')], cron_expr: '0 9 * * 1' } as any]);
        expect(editSourcesButtons(page)).toHaveLength(0);
    });
});
