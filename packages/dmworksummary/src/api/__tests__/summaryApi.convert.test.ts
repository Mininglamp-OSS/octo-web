import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as base from '@octo/base';
import { convertSummaryToDoc } from '../summaryApi';

// Use the registered conversion port to assert the payload sent to either host.
const docs = base as typeof base & {
    __setDocsOn(value: boolean): void;
    __setDocsConvertHandler(handler: (input: { title: string; markdown: string }) => Promise<{ docId: string; url: string }>): void;
    __resetDocsPort(): void;
};
const document = { docId: 'test-doc', url: '/d/test-doc' };
const convert = vi.fn().mockResolvedValue(document);
const markdown = '# Body\n\nKeep\ttabs and\nline breaks in the content.';

describe('summary conversion title at the Docs port', () => {
    beforeEach(() => {
        convert.mockClear();
        docs.__setDocsOn(true);
        docs.__setDocsConvertHandler(convert);
    });
    afterEach(() => docs.__resetDocsPort());

    it.each([
        ['总结\t最近一天的工作', '总结 最近一天的工作'],
        ['周报\r\n第二行', '周报 第二行'],
        ['测试\u0000标题\u007f内容', '测试 标题 内容'],
        ['\t 标题 \r\n', '标题'],
        ['\t\r\n\u0000\u007f ', base.t('summary.detail.defaultTitle')],
        ['', base.t('summary.detail.defaultTitle')],
        ['正常标题 👨‍👩‍👧‍👦', '正常标题 👨‍👩‍👧‍👦'],
    ])('exports %j as a valid single-line title', async (title, expected) => {
        await expect(convertSummaryToDoc(title, markdown)).resolves.toEqual(document);
        expect(convert).toHaveBeenCalledExactlyOnceWith({ title: expected, markdown });
        expect(expected).not.toMatch(/[\u0000-\u001f\u007f]/);
    });

    it('preserves the host error for the existing error UI', async () => {
        const error = { response: { status: 403, data: { error: 'forbidden' } } };
        convert.mockRejectedValueOnce(error);
        await expect(convertSummaryToDoc('标题\t测试', markdown)).rejects.toBe(error);
        expect(convert).toHaveBeenCalledExactlyOnceWith({ title: '标题 测试', markdown });
    });
});
