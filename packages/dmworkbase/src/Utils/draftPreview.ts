import {
    MENTION_LABEL_AIS,
    MENTION_LABEL_HUMANS,
    MENTION_UID_AIS,
    MENTION_UID_HUMANS,
    MENTION_UID_LEGACY_ALL,
} from "./mentionRender"

export function formatDraftPreview(draft: string): string {
    if (!draft) return ""

    return draft.replace(/@\[([^:\]]+):([^\]]+)\]/g, (_match, uid: string, label: string) => {
        if (uid === MENTION_UID_LEGACY_ALL || uid === MENTION_UID_HUMANS) {
            return `@${MENTION_LABEL_HUMANS}`
        }
        if (uid === MENTION_UID_AIS) {
            return `@${MENTION_LABEL_AIS}`
        }
        return `@${label}`
    })
}
