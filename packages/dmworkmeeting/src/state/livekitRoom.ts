// LiveKit media layer — [proposed] per frontend appendix §9. Business admission
// is ALWAYS decided by evaluate/finalize; SDK media (re)connection is never an
// admission authority. The client is React-17-safe: we use the framework-neutral
// `livekit-client` (NOT @livekit/components-react v2, which is React-18-only),
// loaded lazily so this package and its tests build before the dependency is
// added under NOTICE/SBOM review.

export interface LiveKitConnectArgs {
  url: string;
  token: string;
}

export interface LiveKitRoomHandle {
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
}

// A string specifier keeps the bundler/typechecker from requiring the SDK to be
// installed at build time; the import resolves at runtime once the dependency
// is added (see package.json follow-up).
const LIVEKIT_MODULE = 'livekit-client';

export async function loadLiveKit(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ LIVEKIT_MODULE)) as Record<string, unknown>;
  } catch {
    // SDK not yet installed → caller surfaces MEETING_LIVEKIT_UNAVAILABLE UX.
    return null;
  }
}

/**
 * Connect only AFTER a successful finalize returned a livekit_url + token.
 * PreJoin never connects. On leave/end/removed/superseded, disconnect() releases
 * tracks. Returns null when the SDK is unavailable so the caller can render the
 * fail-closed media state without crashing.
 */
export async function connectRoom(args: LiveKitConnectArgs): Promise<LiveKitRoomHandle | null> {
  const sdk = await loadLiveKit();
  if (!sdk) return null;
  const RoomCtor = sdk.Room as (new () => { connect: (u: string, t: string) => Promise<void>; disconnect: () => Promise<void>; state?: string }) | undefined;
  if (!RoomCtor) return null;
  const room = new RoomCtor();
  await room.connect(args.url, args.token);
  return {
    disconnect: () => room.disconnect(),
    isConnected: () => room.state === 'connected',
  };
}
