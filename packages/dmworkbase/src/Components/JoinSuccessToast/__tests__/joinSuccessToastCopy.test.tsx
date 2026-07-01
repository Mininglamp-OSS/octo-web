/**
 * dmwork-web#1068 Round 2 — toast copy de-duplication.
 *
 * Jerry-Xin non-blocking: when entityName === spaceName (pure Space join, no
 * separate group name), the toast would otherwise show
 *   「已加入 ExampleCorp 群聊 / 位于 ExampleCorp 空间」
 * which repeats the same name twice. The simplified branch prints one line:
 *   「已加入「ExampleCorp」空间」
 * and still surfaces the switch button in the cross-space variant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showJoinSuccessToast } from '../index';
import { i18n } from '../../../i18n';

type ToastCall = { kind: 'success' | 'info'; content: any; duration?: number };

// `vi.mock()` factories are hoisted above top-level statements, so closing over
// a top-level `const recorded` would see `undefined` at factory execution time.
// Use `vi.hoisted()` to co-hoist the shared array alongside the mock factory.
const { recorded } = vi.hoisted(() => ({ recorded: [] as ToastCall[] }));

vi.mock('@douyinfe/semi-ui', () => ({
    Toast: {
        success: (opts: any) => { recorded.push({ kind: 'success', ...opts }); return 'toast-id'; },
        info: (opts: any) => { recorded.push({ kind: 'info', ...opts }); return 'toast-id'; },
        close: () => {},
    },
}));

function renderedText(content: any): string {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    const walk = (n: any): string => {
        if (n == null || n === false) return '';
        if (typeof n === 'string' || typeof n === 'number') return String(n);
        if (Array.isArray(n)) return n.map(walk).join('');
        if (n.props && n.props.children !== undefined) return walk(n.props.children);
        return '';
    };
    return walk(content);
}

describe('showJoinSuccessToast — copy de-duplication', () => {
    beforeEach(() => {
        // Assertions expect Chinese copy; pin zh-CN (jsdom navigator defaults to en-US).
        i18n.setLocale('zh-CN', { persist: false, notify: false });
        recorded.length = 0;
    });

    it('same-space + sameName: single simplified line, no duplicate Space name', () => {
        showJoinSuccessToast({ entityName: 'ExampleCorp', spaceName: 'ExampleCorp', crossSpace: false });
        expect(recorded).toHaveLength(1);
        const call = recorded[0];
        expect(call.kind).toBe('success');
        const text = renderedText(call.content);
        expect(text).toContain('已加入');
        expect(text).toContain('ExampleCorp');
        expect(text).toContain('空间');
        expect(text).not.toContain('群聊');
        expect(text).not.toContain('位于');
        const matches = text.match(/ExampleCorp/g) || [];
        expect(matches.length).toBe(1);
    });

    it('cross-space + sameName: single simplified line + switch button', () => {
        showJoinSuccessToast({ entityName: 'ExampleCorp', spaceName: 'ExampleCorp', crossSpace: true });
        expect(recorded).toHaveLength(1);
        const call = recorded[0];
        expect(call.kind).toBe('info');
        const text = renderedText(call.content);
        expect(text).toContain('已加入');
        expect(text).toContain('ExampleCorp');
        expect(text).toContain('切换过去');
        expect(text).not.toContain('位于');
        expect(text).not.toContain('群聊');
        const matches = text.match(/ExampleCorp/g) || [];
        expect(matches.length).toBe(1);
    });

    it('cross-space + distinct entityName/spaceName: keeps the two-line layout', () => {
        showJoinSuccessToast({ entityName: '产品群', spaceName: 'ExampleCorp', crossSpace: true });
        expect(recorded).toHaveLength(1);
        const text = renderedText(recorded[0].content);
        expect(text).toContain('产品群');
        expect(text).toContain('群聊');
        expect(text).toContain('位于');
        expect(text).toContain('ExampleCorp');
        expect(text).toContain('切换过去');
    });

    it('same-space + distinct entityName/spaceName: prints entityName only', () => {
        showJoinSuccessToast({ entityName: '产品群', spaceName: 'ExampleCorp', crossSpace: false });
        const text = renderedText(recorded[0].content);
        expect(text).toContain('产品群');
        expect(text).not.toContain('ExampleCorp');
    });
});
