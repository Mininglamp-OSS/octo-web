/**
 * 总结正文里引用锚点标记的清理（转在线文档 / 隐私收口时用）。
 *
 * 只剥离渲染侧认定为「引用锚点」的两种形态，且与渲染权威逐一对齐：
 *  - 用户引用 `\[(\d+)\](?!\()` —— 与 CitationText.tsx / citationFormat.ts:53 一致，
 *    `(?!\()` 明确排除 `[n](url)` markdown 链接；
 *  - 团队引用 `\[P(\d{1,3})\]` —— 与后端 `meta_processor.go` 的 `teamCitationRe`
 *    逐字节一致（三位封顶；后端 RE2 无 lookahead，团队正文为 LLM 纯文本、不会
 *    产出 `[P1](url)`，故按后端字面匹配，不加链接守卫）。
 *
 * 相对 head commit 86f6f7ba 的内联正则，这里修掉 round-4 P1-a 的三个缺陷：
 *  1. **不扫代码** —— 围栏块 / 行内代码里的 `[n]`（如 `items[0]`、`argv[1]`）
 *     从不被渲染成引用，清理同样整块跳过，不再把 `items[0]` 削成 `items`；
 *  2. **不碰链接与引用定义** —— `[1](url)`、行首 `[1]: url` 原样保留；
 *  3. **不吞换行** —— 不再用会匹配 `\n` 的 `\s?` 去吃前导空白，行首标记只删
 *     自身（外加一个水平空格），保住标题/列表等块结构。
 *
 * 分组形态 `[1,2]`、范围形态 `[30-35]` 是渲染期由 `formatGroupLabel`
 * （citationFormat.ts）从相邻单标记合成的，存储正文里不存在，故不识别、不剥离。
 */
export function stripCitationMarkers(source: string): string {
    if (!source) return source;

    // 单次扫描：受保护的区域（代码 / 链接 / 引用定义）命中后原样放回，
    // 只有最后两个分支（真正的引用锚点）返回空串被删除。
    const token = new RegExp(
        [
            // 围栏代码块，整块保护
            '(?:^|\\n)[^\\S\\n]*```[\\s\\S]*?(?:```|$)',
            // 行内代码，整段保护
            '`[^`\\n]+`',
            // markdown 链接 [text](url)，含与引用同形的 [1](url)
            '\\[[^\\]\\n]*\\]\\([^)\\n]*\\)',
            // 行首引用定义 [label]: url
            '(?:^|\\n)[^\\S\\n]*\\[[^\\]\\n]*\\]:[^\\n]*',
            // 用户引用 [n]：(?!\() 排除链接；尾随一个水平空格一并删，避免残留
            '\\[(\\d+)\\](?!\\()[ \\t]?',
            // 团队引用 [Pn]：与后端权威一致，三位封顶
            '\\[P(\\d{1,3})\\][ \\t]?',
        ].join('|'),
        'g',
    );

    return source.replace(token, (match, userNum, teamNum) => {
        // 仅最后两个捕获组（引用锚点）删除；受保护 token 原样返回。
        return userNum !== undefined || teamNum !== undefined ? '' : match;
    });
}
