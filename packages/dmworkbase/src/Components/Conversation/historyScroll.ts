export const TOP_HISTORY_TRIGGER_OFFSET = 250

export interface PulldownScrollRestoreInput {
    previousScrollHeight: number
    previousScrollTop: number
    nextScrollHeight: number
}

export interface ScrollAnchorOffsetInput {
    scrollTop: number
    anchorOffsetTop: number
}

export interface AnchorScrollRestoreInput {
    anchorOffsetTop: number
    keepOffsetY: number
}

export function getPulldownRestoredScrollTop(input: PulldownScrollRestoreInput): number {
    const nextScrollTop = input.previousScrollTop + (input.nextScrollHeight - input.previousScrollHeight)
    return nextScrollTop < 0 ? 0 : nextScrollTop
}

export function getScrollAnchorOffsetY(input: ScrollAnchorOffsetInput): number {
    const offsetY = input.scrollTop - input.anchorOffsetTop
    return offsetY < 0 ? 0 : offsetY
}

export function getRestoredAnchorScrollTop(input: AnchorScrollRestoreInput): number {
    const scrollTop = input.anchorOffsetTop + input.keepOffsetY
    return scrollTop < 0 ? 0 : scrollTop
}

export function shouldPulldownOnWheel(deltaY: number, scrollTop: number, isFullScreen: boolean): boolean {
    if (deltaY >= 0) {
        return false
    }
    if (!isFullScreen) {
        return true
    }
    return scrollTop <= TOP_HISTORY_TRIGGER_OFFSET
}
