// 群级「允许群内 Bot 免@回答」开关的纯读值逻辑，单独抽出便于单测。
//
// 语义：server 透出 allow_no_mention（0=关 / 1=开）。老后端无此字段时
// orgData 上为 undefined → 缺省回退 true（允许），保持零回归。
// 只有显式拿到 0 才算「关」，其它（1 / undefined / null）都算「开」。
export function readAllowNoMention(
  orgData: { allow_no_mention?: number } | undefined | null
): boolean {
  return orgData?.allow_no_mention !== 0;
}
