/**
 * Read-attention gate shared by the Ordinary Web and the single installed
 * desktop communication runtime.
 *
 * Ordinary Web is always allowed. A desktop owner may install exactly one
 * exclusive gate; while installed it can deny read attention, which must
 * stop the conversation UI from recording reads or claiming the SDK-level
 * open conversation.
 */
type ReadAttentionListener = (allowed: boolean) => void

interface InstalledGate {
    allowed: boolean
    listeners: Set<ReadAttentionListener>
    revision: number
}

/** Ordinary Web default. */
const allowedByDefault = true

let installedGate: InstalledGate | undefined

function notifyListeners(gate: InstalledGate, allowed: boolean): void {
    const revision = gate.revision
    for (const listener of Array.from(gate.listeners)) {
        if (installedGate !== gate || gate.revision !== revision) return
        if (!gate.listeners.has(listener)) continue
        try {
            listener(allowed)
        } catch (error) {
            // A host listener must never break gate bookkeeping.
            console.error("[im-runtime/readAttention] listener failed", error)
        }
    }
}

export interface ImReadAttentionGate {
    setAllowed(allowed: boolean): void
    dispose(): void
}

/**
 * Installs the exclusive desktop read-attention gate.
 *
 * Rejects a second install: only one owner may control read attention at a
 * time. Disposal restores the Ordinary Web default only after the owner has
 * revoked or torn down (caller is responsible for that ordering).
 */
export function installImReadAttentionGate(
    initialAllowed = false,
): ImReadAttentionGate {
    if (installedGate) {
        throw new Error("[im-runtime/readAttention] a read-attention gate is already installed")
    }
    const gate: InstalledGate = {
        allowed: initialAllowed,
        listeners: new Set(),
        revision: 0,
    }
    installedGate = gate
    return {
        setAllowed(allowed: boolean): void {
            const next = !!allowed
            if (!installedGate || installedGate !== gate || gate.allowed === next) {
                return
            }
            gate.allowed = next
            gate.revision++
            notifyListeners(gate, next)
        },
        dispose(): void {
            if (!installedGate || installedGate !== gate) {
                return
            }
            installedGate = undefined
            gate.listeners.clear()
        },
    }
}

/** Whether the current environment may record read attention. */
export function isImReadAttentionAllowed(): boolean {
    return installedGate ? installedGate.allowed : allowedByDefault
}

/**
 * Subscribes to transitions of the effective read-attention allowance.
 *
 * The returned unsubscribe is idempotent and safe to call after dispose.
 */
export function subscribeImReadAttention(
    listener: ReadAttentionListener,
): () => void {
    const gate = installedGate
    if (gate) {
        gate.listeners.add(listener)
        return () => {
            gate.listeners.delete(listener)
        }
    }
    return () => {}
}
