import { MessageWrap } from "../../Service/Model"

export interface FoldSessionSummarySource {
    isActive: boolean
    showSummary: boolean
    typing?: MessageWrap
    lastMessage: MessageWrap
}

export interface FoldSessionExpandedMessagesSource {
    messages: MessageWrap[]
    typing?: MessageWrap
}

export interface FoldSessionSummaryState {
    showSummary: boolean
    summaryId?: string
    summaryMessage: MessageWrap
}

export function getFoldSessionSummaryState(session: FoldSessionSummarySource): FoldSessionSummaryState {
    const summaryMessage = session.typing || session.lastMessage
    const showSummary = session.isActive || session.showSummary

    return {
        showSummary,
        summaryId: showSummary && !session.typing ? session.lastMessage.clientMsgNo : undefined,
        summaryMessage,
    }
}

export function getFoldSessionExpandedMessages(session: FoldSessionExpandedMessagesSource): MessageWrap[] {
    if (session.messages.length === 0) {
        return []
    }
    if (session.typing) {
        return [...session.messages]
    }
    return session.messages.slice(0, -1)
}

export function isFoldSessionSummaryMessage(session: FoldSessionSummarySource, messageSeq: number): boolean {
    return getFoldSessionSummaryState(session).showSummary
        && !session.typing
        && session.lastMessage.messageSeq === messageSeq
}
