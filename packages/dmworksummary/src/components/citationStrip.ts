/**
 * 总结正文里引用锚点标记的清理（转在线文档时用）。
 *
 * ⚠️ RED commit 状态：当前实现是 head commit 86f6f7ba 的内联正则**原样搬移**，
 * 专门用来让 __tests__/citationStrip.test.ts 里的复现用例失败（round-4 P1-a，
 * @yujiawei review 5006002580 的复现表）。正确实现见后续 GREEN commit。
 */
export function stripCitationMarkers(source: string): string {
    if (!source) return source;
    return source.replace(/\s?\[P?\d+(?:[,，]\s*P?\d+)*\]/g, "");
}
