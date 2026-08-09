// LiveKit media layer — [proposed] per frontend appendix §9. Business admission
// is ALWAYS decided by evaluate/finalize; SDK media (re)connection is never an
// admission authority. React-17-safe: framework-neutral `livekit-client`, NOT
// @livekit/components-react v2.
//
// The `livekit-client` dependency is NOT installed in this PR (it is a deferred
// blocker pending NOTICE/SBOM review). Until it lands, connectRoom resolves
// `null` and JoinFlow surfaces an explicit "media unavailable" state with greyed
// controls (it never presents the room as connected). When the dependency is
// added, replace the guarded loader below with a static `import('livekit-client')`
// so Vite code-splits it — a bare *variable* specifier cannot be resolved by the
// browser and must not be relied upon.

export interface LiveKitConnectArgs {
  url: string;
  token: string;
}

export interface LiveKitRoomHandle {
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
}

/** Returns the SDK module when installed, else null. Overridable in tests. */
let _loadLiveKit: () => Promise<Record<string, unknown> | null> = async () => {
  // Intentionally returns null until `livekit-client` is added as a dependency
  // (deferred: NOTICE/SBOM). Swapped for `() => import('livekit-client')` then.
  return null;
};

export function __setLiveKitLoader(fn: () => Promise<Record<string, unknown> | null>): void {
  _loadLiveKit = fn;
}

export async function loadLiveKit(): Promise<Record<string, unknown> | null> {
  try {
    return await _loadLiveKit();
  } catch {
    return null;
  }
}

/**
 * Connect only AFTER a successful finalize returned a livekit_url + token.
 * PreJoin never connects. Returns null when the SDK is unavailable OR the
 * connection fails, so the caller renders the fail-closed media state without
 * crashing and without falsely showing a connected room.
 */
export async function connectRoom(args: LiveKitConnectArgs): Promise<LiveKitRoomHandle | null> {
  const sdk = await loadLiveKit();
  if (!sdk) return null;
  const RoomCtor = sdk.Room as (new () => { connect: (u: string, t: string) => Promise<void>; disconnect: () => Promise<void>; state?: string }) | undefined;
  if (!RoomCtor) return null;
  try {
    const room = new RoomCtor();
    await room.connect(args.url, args.token);
    return {
      disconnect: () => room.disconnect(),
      isConnected: () => room.state === 'connected',
    };
  } catch {
    // A connect failure is surfaced as "media unavailable", not a crash.
    return null;
  }
}
