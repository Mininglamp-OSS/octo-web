import {
    MENTION_LABEL_AIS,
    MENTION_LABEL_HUMANS,
    MENTION_UID_AIS,
    MENTION_UID_HUMANS,
    MENTION_UID_LEGACY_ALL,
} from "./mentionRender"

export function formatDraftPreview(draft: string): string {
    if (!draft) return ""

    let result = ""
    let index = 0

    while (index < draft.length) {
        const start = draft.indexOf("@[", index)
        if (start === -1) {
            result += draft.slice(index)
            break
        }

        result += draft.slice(index, start)

        const end = draft.indexOf("]", start + 2)
        if (end === -1) {
            result += draft.slice(start)
            break
        }

        const markerBody = draft.slice(start + 2, end)
        const colon = markerBody.indexOf(":")
        if (colon <= 0 || colon === markerBody.length - 1) {
            result += draft.slice(start, end + 1)
            index = end + 1
            continue
        }

        const uid = markerBody.slice(0, colon)
        const label = markerBody.slice(colon + 1)

        if (uid === MENTION_UID_LEGACY_ALL || uid === MENTION_UID_HUMANS) {
            result += `@${MENTION_LABEL_HUMANS}`
        } else if (uid === MENTION_UID_AIS) {
            result += `@${MENTION_LABEL_AIS}`
        } else {
            result += `@${label}`
        }

        index = end + 1
    }

    return result
}
