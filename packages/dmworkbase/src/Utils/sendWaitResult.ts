export function isSuccessfulSendAck(ackPacket?: { reasonCode?: number }): boolean {
    return ackPacket?.reasonCode === 1
}

export function messageStatusWaitResult(
    status: unknown,
    normalStatus: unknown,
    failStatus: unknown,
): boolean | undefined {
    if (status === normalStatus) return true
    if (status === failStatus) return false
    return undefined
}

export function taskStatusWaitResult(
    status: unknown,
    successStatus: unknown,
    failStatus: unknown,
): boolean | undefined {
    if (status === successStatus) return true
    if (status === failStatus) return false
    return undefined
}
