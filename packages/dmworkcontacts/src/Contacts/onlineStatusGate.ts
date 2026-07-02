// 在线态（绿点）仅面向 AI 条目。真人联系人不展示在线绿点、也不预取其在线态，
// 以免在「全部联系人」区暴露真人在线状态（隐私边界）。这里集中收口该门控，
// 供 badge 渲染与按需预取共用。
export function shouldShowOnlineStatus(item: { robot?: boolean } | null | undefined): boolean {
    return item?.robot === true
}

// 从一批条目中挑出需要预取在线态的 uid：仅 AI 条目、uid 非空。
export function selectOnlineStatusUids(items: Array<{ uid?: string; robot?: boolean }>): string[] {
    const uids: string[] = []
    for (const item of items) {
        if (shouldShowOnlineStatus(item) && item.uid) uids.push(item.uid)
    }
    return uids
}
