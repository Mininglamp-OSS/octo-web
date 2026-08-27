/**
 * SummaryListPage 侧边栏待关注红点接线测试 (#1359)。
 *
 * 只有全局列表 loadData 成功时才用 attention_count 同步 NavRail；
 * 聊天侧栏是嵌入式 channel 实例，不拥有全局导航状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Dropdown: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
    Tooltip: () => null,
}));
vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => null,
    IconPlus: () => null,
    IconRefresh: () => null,
}));
vi.mock('../../components/SummaryCard', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import { WKApp } from '@octo/base';
import SummaryListPage from '../SummaryListPage';
import { getSummaryAttentionBadge, setSummaryAttentionBadge, refreshSummaryAttentionBadge } from '../../utils/summaryAttentionBadge';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

function makePage(props: Record<string, unknown> = {}) {
    const page = new SummaryListPage(props as any);
    (page as any).state = {
        ...(page.state as any),
        items: [],
        page: 1,
        pageSize: 20,
        statusFilter: undefined,
        keyword: '',
        loading: false,
        loadingMore: false,
        hasMore: false,
    };
    (page as any).isMounted_ = true;
    (page as any).setState = function (this: any, patch: any, cb?: () => void) {
        const resolved = typeof patch === 'function' ? patch(this.state) : patch;
        this.state = { ...this.state, ...resolved };
        cb?.();
    };
    vi.spyOn(page as any, 'maybeStartBatchPoll').mockImplementation(() => {});
    vi.spyOn(page as any, 'stopBatchPoll').mockImplementation(() => {});
    return page;
}

describe('SummaryListPage — 侧边栏待关注红点同步 (#1359)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        setSummaryAttentionBadge(0);
    });

    it('全局列表 loadData 用后端 attention_count 同步红点', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 3,
            unread_count: 1,
            pending_invitation_count: 1,
            pending_submission_count: 1,
        } as any);

        const page = makePage();
        await (page as any).loadData();

        expect(getSummaryAttentionBadge()).toBe(3);
    });

    it('聊天侧栏（带 channelId）不覆盖全局 Space badge', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({
            items: [],
            total: 0,
            attention_count: 9,
            unread_count: 9,
            pending_invitation_count: 0,
        } as any);

        setSummaryAttentionBadge(2);
        const page = makePage({ channelId: 'ch-1' });
        await (page as any).loadData();

        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('后端未返回 attention_count 时红点归零', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ items: [], total: 0 } as any);

        setSummaryAttentionBadge(4);
        const page = makePage();
        await (page as any).loadData();

        expect(getSummaryAttentionBadge()).toBe(0);
    });

    it('跨 Space 的迟到列表响应不覆盖新 Space badge', async () => {
        const response = deferred<any>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(response.promise);
        setSummaryAttentionBadge(2);

        WKApp.shared.currentSpaceId = 'space-a';
        const page = makePage();
        const pending = (page as any).loadData();
        WKApp.shared.currentSpaceId = 'space-b';
        response.resolve({ items: [], total: 0, attention_count: 9 });
        await pending;

        expect(getSummaryAttentionBadge()).toBe(2);
    });

    it('卸载后的列表响应不再写全局 badge', async () => {
        const response = deferred<any>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(response.promise);
        setSummaryAttentionBadge(2);

        const page = makePage();
        const pending = (page as any).loadData();
        (page as any).isMounted_ = false;
        response.resolve({ items: [], total: 0, attention_count: 9 });
        await pending;

        expect(getSummaryAttentionBadge()).toBe(2);
    });
});

// Ticket liveness：loadData 领号后若失败/被顶掉，必须把号
// 还回去，否则它会把一个发出更早、仍在飞、携带正确值的探测一并作废，
// 角标卡陈值。成功 commit 则绝不能还号（那会给陈旧快照开后门）。
describe('SummaryListPage — loadData 的读取号生死 (ticket liveness)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        WKApp.loginInfo.uid = 'test-uid';
        vi.spyOn(WKApp.loginInfo, 'isLogined').mockReturnValue(true);
        vi.spyOn(WKApp.menus, 'refresh').mockImplementation(() => {});
        setSummaryAttentionBadge(0);
    });

    it('loadData 失败后还号：更早发出的探测仍能把正确值落盘', async () => {
        // 先有一个探测在飞（领号在前），它带着正确值但还没回来。
        const probe = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(probe.promise);
        const pendingProbe = refreshSummaryAttentionBadge();

        // 随后全局列表加载失败（领号在后）。
        vi.mocked(api.listSummaries).mockRejectedValueOnce(new Error('network'));
        const page = makePage();
        await (page as any).loadData();
        // 旧值保持，失败不写。
        expect(getSummaryAttentionBadge()).toBe(0);

        // 关键：loadData 失败已把号还回，探测的正确值得以落盘；
        // 不还号的旧实现里它会被作废，角标卡 0。
        probe.resolve({ attention_count: 5 });
        await pendingProbe;
        expect(getSummaryAttentionBadge()).toBe(5);
    });

    it('loadData 成功落盘后不会把已消费的号还回去', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ items: [], total: 0, attention_count: 3 } as any);
        const page = makePage();
        await (page as any).loadData();
        expect(getSummaryAttentionBadge()).toBe(3);

        // 此后新探测领的号仍在列表号之后且能正常落盘：证明成功 commit
        // 没有把号回退、给更早的陈旧快照开后门。
        const probe = deferred<any>();
        vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(probe.promise);
        const pendingProbe = refreshSummaryAttentionBadge();
        probe.resolve({ attention_count: 1 });
        await pendingProbe;
        expect(getSummaryAttentionBadge()).toBe(1);
    });
});
