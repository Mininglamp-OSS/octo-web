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

// round2 竞态守卫的纯决策逻辑，抽出便于单测。
//
// 场景：GroupManagement 挂载时发起一次 fetch；toggle 时又发起写入 + 回读 fetch。
// 每次「权威操作」自增 opSeq。一个异步 fetch resolve 时，只有当它仍是最新操作
// （myOp === currentOp）且当前没有正在进行的保存（!saving）时，才允许把它的结果
// 回写到开关 state。否则丢弃，避免较早的 stale fetch 覆盖较新的 toggle 结果。
export function shouldApplyFetchResult(
  myOp: number,
  currentOp: number,
  saving: boolean
): boolean {
  return myOp === currentOp && !saving;
}

// listener 回写守卫：只有当没有「我方在途 fetch」且不处于保存中时，才允许由外部
// 频道更新（如他人改了设置）经 listener 回写开关，避免我方 fetch 经 listener
// 覆盖刚 toggle 的乐观值。
export function shouldListenerApply(
  inflightFetch: number,
  saving: boolean
): boolean {
  return inflightFetch <= 0 && !saving;
}
