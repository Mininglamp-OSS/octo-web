import { describe, it, expect } from 'vitest';
import { stripCitationMarkers } from '../citationStrip';

/**
 * 「转为在线文档」前清理引用锚点标记的契约测试（octo-smart-summary#195）。
 *
 * 权威来自渲染侧，本 helper 必须与之一致：
 *  - 用户引用 `/\[(\d+)\](?!\()/g`（CitationText.tsx / citationFormat.ts:53，
 *    故意排除 `[n](url)` markdown 链接形态）；
 *  - 团队引用 `/\[P(\d{1,3})\]/g`（与后端 meta_processor.go 逐字节一致）；
 *  - remarkCitation 只走 AST 文本节点，代码（围栏块 / 行内代码）里的 `[n]`
 *    从不被渲染成引用 —— 清理同样不能碰。
 */
describe('stripCitationMarkers', () => {
    describe('Markdown 语义边界', () => {
        it('markdown 链接 [n](url) 原样保留', () => {
            const input = '详见 [1](https://wiki.example.com/x) 的说明';
            expect(stripCitationMarkers(input)).toBe(input);
        });

        it('围栏代码块里的 [n] 不被剥离', () => {
            const input = '```js\nconst first = items[0];\nconsole.log(argv[1]);\n```';
            expect(stripCitationMarkers(input)).toBe(input);
        });

        it('行内代码里的 [n] 不被剥离', () => {
            const input = '取值用 `arr[0]` 即可';
            expect(stripCitationMarkers(input)).toBe(input);
        });

        it('有效引用定义及其正文引用整体原样保留', () => {
            const input = '见文档[1]\n\n[1]: https://example.com/doc';
            expect(stripCitationMarkers(input)).toBe(input);
        });

        it.each([
            ['tilde fence', '~~~js\nitems[0]\n~~~\n结论[P1]', '~~~js\nitems[0]\n~~~\n结论'],
            ['indented code', '    items[0]\n\n结论[1]', '    items[0]\n\n结论'],
            ['blockquote fence', '> ```js\n> items[1]\n> ```\n\n结论[2]', '> ```js\n> items[1]\n> ```\n\n结论'],
            ['unclosed fence', '~~~js\nitems[0]\n正文[1]', '~~~js\nitems[0]\n正文[1]'],
            ['hard break', '第一行[1]  \n第二行', '第一行  \n第二行'],
            ['escaped marker', String.raw`前\[1\]后`, '前后'],
            ['entity marker', '前&#91;1&#93;后', '前后'],
            ['terminal entity marker', '前&#91;1&#93;', '前'],
            ['nested link text', '[see [1]](/doc)', '[see ](/doc)'],
            ['invalid definition', '[1]: 张三 提交了报告[2]', ': 张三 提交了报告'],
            ['CRLF paragraph', 'foo[1]\r\nbar[2]', 'foo\r\nbar'],
            ['multiline blockquote', '> foo[1]\n> bar[2]', '> foo\n> bar'],
            ['multiline bullet', '- foo[1]\n  bar[2]', '- foo\n  bar'],
            ['multiline ordered item', '1. foo[1]\n   bar[2]', '1. foo\n   bar'],
            ['tab continuation', 'foo[1]\n\tbar[2]', 'foo\n\tbar'],
            ['normalized NUL fallback', 'foo\0bar[1]', 'foo\0bar'],
        ])('%s', (_, input, expected) => {
            expect(stripCitationMarkers(input)).toBe(expected);
        });
    });

    describe('核心功能', () => {
        it('剥离普通用户引用 [n]', () => {
            expect(stripCitationMarkers('本周完成了登录模块[1]。')).toBe('本周完成了登录模块。');
        });

        it('只剥离团队引用 [Pn]，保留周边空格', () => {
            expect(stripCitationMarkers('由 [P1] 负责')).toBe('由  负责');
        });

        it('行首标记只删除自身，不吞掉换行或空格', () => {
            const input = '## 本周进展\n[1] 张三提交了报告';
            expect(stripCitationMarkers(input)).toBe('## 本周进展\n 张三提交了报告');
        });

        it('连续多个标记全部剥离', () => {
            expect(stripCitationMarkers('结论[1][2]。')).toBe('结论。');
        });

        it('空内容原样返回', () => {
            expect(stripCitationMarkers('')).toBe('');
        });

        it('无标记文本原样返回', () => {
            expect(stripCitationMarkers('没有任何标记的文本')).toBe('没有任何标记的文本');
        });
    });

    describe('对齐权威', () => {
        it('超过三位的 [P1234] 不剥离（后端权威 \\[P(\\d{1,3})\\]）', () => {
            expect(stripCitationMarkers('编号[P1234]保留')).toBe('编号[P1234]保留');
        });

        it('分组形态 [1,2] 不是存储里的引用形态，不碰（渲染期才由 formatGroupLabel 产生）', () => {
            expect(stripCitationMarkers('分组[1,2]保留')).toBe('分组[1,2]保留');
        });
    });
});
