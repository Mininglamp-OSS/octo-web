/**
 * 当前 space 是否存在至少一个在线运行时 —— 决定能否创建 Bot。
 * 仅精确匹配 "online";其它(含 "offline"、空、大小写变体)均视为不可创建。
 */
export function canCreateBot(runtimes: { status: string }[]): boolean {
    return runtimes.some((r) => r.status === "online")
}
