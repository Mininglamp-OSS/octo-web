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

        // 自动链接的 URL 本身就是 link 节点下唯一的 text 子节点，`visit(tree,'text')`
        // 会直接走进目的地址。删掉其中的 `[n]` 等于改写链接目标 —— 而这在屏幕上看不出来：
        // 渲染器做同样的文本替换，但 `<a href>` 保留完整 URL，链接照样能点。转出去的文档
        // 没有 href 兜底，被改坏的字符串**就是**链接本身，且会被持久化。
        // 见 isAutolinkDestination。
        describe('自动链接目的地不可改写', () => {
            it.each([
                ['GFM 裸链接', 'Source: https://wiki.corp/page?ids[1]=42&x=1 more [1]\n',
                    'Source: https://wiki.corp/page?ids[1]=42&x=1 more \n'],
                ['<> 自动链接', 'see <https://x.com/a[1]b>\n', 'see <https://x.com/a[1]b>\n'],
                ['www 自动链接', 'www.example.com/a[1]b and [2]\n', 'www.example.com/a[1]b and \n'],
            ])('%s', (_, input, expected) => {
                expect(stripCitationMarkers(input)).toBe(expected);
            });

            // 对照组：普通 [label](dest) 链接的**文字**仍然要剥离 —— 那是读者看得见的正文，
            // 不是目的地址。所以守卫刻意匹配自动链接的形状，而不是笼统地跳过 parent.type==='link'。
            it('普通链接的文字仍然剥离，目的地址本就安全', () => {
                expect(stripCitationMarkers('[see [1] more](http://u.com)\n'))
                    .toBe('[see  more](http://u.com)\n');
                expect(stripCitationMarkers('[label](http://u.com/a[1]b) and [2]\n'))
                    .toBe('[label](http://u.com/a[1]b) and \n');
            });

            // 记录一个**未修复**的邻近情形，避免下一个人误以为它也被覆盖了。
            // `<a[1]b@x.com>` 里的 `[1]` 打断了自动链接的识别：remark 解析成
            // text `"mail <a[1]"` + link(mailto:b@x.com) + text `">"`，被删的 `[1]`
            // 落在**纯文本**节点里，不在目的地址上，所以上面的守卫按设计不会拦它。
            // 后果是 href 从 `mailto:b@x.com` 变成 `mailto:ab@x.com`。两种取舍都说得通
            // （剥离后的结果恰好是用户本来想写的邮箱），此处先钉住现状。
            it('[n] 打断邮箱自动链接时走纯文本路径（现状，非目的地改写）', () => {
                expect(stripCitationMarkers('mail <a[1]b@x.com>\n')).toBe('mail <ab@x.com>\n');
            });
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
