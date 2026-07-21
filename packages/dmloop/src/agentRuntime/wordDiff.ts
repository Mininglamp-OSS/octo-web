// @octo/loop — 行内 word diff（纯函数，供富 diff split/unified 行内高亮）
//
// 对一对「删除行 / 新增行」做词级最长公共子序列（LCS）比对，标出真正变化的片段，
// 避免整行标红/标绿。纯函数，无 React 依赖，单测直接覆盖。

export type WordDiffKind = "equal" | "insert" | "delete";
export interface WordDiffSegment {
  kind: WordDiffKind;
  value: string;
}

// 按「词 + 空白 + 标点」切分，保留分隔符（diff 结果可无损拼回原文）。
export function tokenize(s: string): string[] {
  const m = s.match(/(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g);
  return m ?? [];
}

// 计算两串 token 的 LCS 长度表（滚动不了，需回溯，故存全表）。
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

// 返回从 oldLine 变到 newLine 的词级片段序列。
export function wordDiff(oldLine: string, newLine: string): WordDiffSegment[] {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const dp = lcsTable(a, b);
  const segs: WordDiffSegment[] = [];
  let i = 0;
  let j = 0;
  // 相邻同类片段合并，输出更紧凑。
  const push = (kind: WordDiffKind, value: string) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.value += value;
    else segs.push({ kind, value });
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < a.length) push("delete", a[i++]);
  while (j < b.length) push("insert", b[j++]);
  return segs;
}
