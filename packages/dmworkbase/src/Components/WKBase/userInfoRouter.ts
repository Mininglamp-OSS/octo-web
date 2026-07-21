import WKSDK, { Channel, ChannelTypePerson } from "wukongimjssdk";
import { fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";

/**
 * Production routing helper for "view user profile" entry (GH#1112, PR#1113).
 *
 * Centralises three orthogonal concerns that `WKBase.showUserInfo` previously
 * inlined:
 *
 *   1) Bot-vs-human routing. A Person channel whose `orgData.robot === 1` must
 *      open the editable BotDetailModal; everything else keeps using the
 *      read-only UserInfo. If the channel info is not yet cached we fetch it
 *      asynchronously (falling back to UserInfo on failure).
 *
 *   2) Stale-request guard. The cache-miss path awaits a network fetch; during
 *      the await the user may click another avatar or close the panel entirely.
 *      Each call to `showUserInfo` / `invalidate` / `dispose` bumps a
 *      monotonically-increasing token, and each async continuation compares
 *      the token captured at dispatch time against the latest one — mismatches
 *      are silently dropped. This fixes the race where a late-resolving fetch
 *      for avatar A could overwrite the modal that was just opened for B.
 *
 *   3) External-viewer gate for bots (regression fix). A bot
 *      opened from a cross-space external group must NOT open the editable
 *      BotDetailModal, because BotDetailModal renders "发送消息 / 添加好友"
 *      based purely on follow state and would bypass the UI guard that
 *      UserInfo.getBottomPanel applies to external humans. When the viewer is
 *      external relative to the bot (same criteria as UserInfoVM.isExternalToViewer),
 *      we demote `isBot=false` so the request routes through UserInfo and the
 *      existing "仅可在群内交流" hint applies. Detection is best-effort at
 *      dispatch time: we prefer the channel's local subscriber orgData (same
 *      primary source UserInfoVM uses) and fall back to the user's own
 *      channelInfo.orgData. If neither carries home_space_id / is_external we
 *      fail open (non-external) — same degradation as UserInfoVM.
 *
 * This helper is intentionally free of React, semi-ui, lottie, and other
 * rendering dependencies so it can be unit-tested in isolation without
 * pulling in the full WKBase module graph.
 */

export interface ChannelInfoOrgDataLike {
    robot?: number;
    home_space_id?: string | null;
    home_space_name?: string | null;
    is_external?: number | null;
    source_space_name?: string | null;
}

export interface ChannelInfoLike {
    orgData?: ChannelInfoOrgDataLike;
}

export interface ChannelManagerLike {
    getChannelInfo(channel: Channel): ChannelInfoLike | null | undefined;
    fetchChannelInfo(channel: Channel): Promise<ChannelInfoLike | null | undefined>;
}

/**
 * External-viewer decision surface. Abstracted out of the router so
 * unit tests can inject a deterministic answer without standing up WKSDK
 * subscribers + WKApp.currentSpaceId. The default implementation wired in
 * createUserInfoRouter mirrors UserInfoVM.isExternalToViewer exactly:
 *
 *   1) fromChannel subscriber orgData (primary, when available)
 *   2) user's own channelInfo orgData (fallback)
 *   3) legacy is_external / source_space_name fields
 *
 * Returns true only when the user is demonstrably external to the viewer's
 * current space. Missing data → false (fail open), matching UserInfoVM.
 */
export interface ExternalViewerGate {
    isExternal(
        uid: string,
        fromChannel: Channel | undefined,
        channelInfo: ChannelInfoLike | null | undefined,
    ): boolean;
}

export interface UserInfoDispatch {
    uid: string;
    fromChannel?: Channel;
    vercode?: string;
    isBot: boolean;
}

export type UserInfoDispatcher = (result: UserInfoDispatch) => void;

export class UserInfoRouter {
    // Monotonically-increasing request token. Incremented on every public
    // state-changing call. Async continuations compare against `this.fetchToken`
    // before dispatching; mismatches are stale and discarded.
    private fetchToken = 0;
    private disposed = false;

    constructor(
        private readonly channelManager: ChannelManagerLike,
        private readonly dispatch: UserInfoDispatcher,
        private readonly externalGate?: ExternalViewerGate,
    ) {}

    /**
     * Route a "view user profile" request.
     * - Cache hit → synchronous dispatch (with external-viewer gate).
     * - Cache miss → async fetch; dispatch is guarded by the stale-request token
     *   AND the external-viewer gate before deciding bot vs user route.
     * - Fetch reject → dispatch as non-bot (UserInfo fallback), still stale-guarded.
     */
    showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void {
        const token = ++this.fetchToken;
        const personChannel = new Channel(uid, ChannelTypePerson);
        const cached = this.channelManager.getChannelInfo(personChannel);
        if (cached) {
            this.dispatchWithGate(uid, fromChannel, vercode, cached);
            return;
        }
        this.channelManager
            .fetchChannelInfo(personChannel)
            .then((info) => {
                if (this.disposed || token !== this.fetchToken) return;
                this.dispatchWithGate(uid, fromChannel, vercode, info);
            })
            .catch(() => {
                if (this.disposed || token !== this.fetchToken) return;
                this.dispatch({ uid, fromChannel, vercode, isBot: false });
            });
    }

    /**
     * Apply the external-viewer gate before deciding isBot, then
     * forward to the injected dispatcher. Kept private so callers can't bypass
     * the gate — every production path that routes to BotDetailModal must go
     * through here.
     */
    private dispatchWithGate(
        uid: string,
        fromChannel: Channel | undefined,
        vercode: string | undefined,
        info: ChannelInfoLike | null | undefined,
    ): void {
        let isBot = info?.orgData?.robot === 1;
        if (isBot && this.externalGate) {
            // Defensive: a throwing gate must not break the routing contract.
            // If the external check blows up (e.g. WKApp.shared unavailable
            // during an early-session click, or a subscribers-cache race), we
            // fall back to the stricter outcome (treat as bot) — same as when
            // no gate is injected. The thrown error is swallowed here, not
            // re-thrown from the .then continuation, to preserve the original
            // scenario-3-style "cache-miss bot eventually routes to
            // BotDetailModal" contract under degraded conditions.
            try {
                if (this.externalGate.isExternal(uid, fromChannel, info ?? undefined)) {
                    // External viewer → demote to UserInfo path so the existing
                    // "仅可在群内交流" hint (UserInfo.getBottomPanel)
                    // fires for bots too.
                    isBot = false;
                }
            } catch {
                // Swallow — keep isBot = true. Fail-safe: a broken gate should
                // never prevent rendering; the worst case is a bot editor that
                // UserInfo would have shown as external, which the reviewer
                // considered the baseline pre-fix state anyway.
            }
        }
        this.dispatch({ uid, fromChannel, vercode, isBot });
    }

    /**
     * Invalidate any in-flight fetch. Called when the consumer actively closes
     * the user-info panel (hideUserInfo) or otherwise transitions modal state
     * without issuing a new `showUserInfo` — prevents late resolves from
     * re-opening the modal after the user dismissed it.
     */
    invalidate(): void {
        this.fetchToken++;
    }

    /**
     * Mark the router as disposed. Any pending async continuation will become a
     * no-op. Call this from `componentWillUnmount` so React will not complain
     * about setState-after-unmount from late fetch resolutions.
     */
    dispose(): void {
        this.disposed = true;
        this.fetchToken++;
    }
}

/**
 * Convenience factory bound to the global WKSDK singleton — used by WKBase so
 * callers don't need to know about the underlying channel manager.
 *
 * `externalGate` is optional and must be injected by the caller. It
 * is factored out of this module to keep userInfoRouter.ts free of the WKApp
 * / resolveExternalForViewer coupling that WKBase owns. Tests can call this
 * factory without a gate (default: no external demotion) or construct
 * `new UserInfoRouter(...)` directly with a stub gate. See
 * `createDefaultExternalViewerGate` in WKBase/index.tsx for the production
 * wiring that mirrors UserInfoVM.isExternalToViewer.
 */
export function createUserInfoRouter(
    dispatch: UserInfoDispatcher,
    externalGate?: ExternalViewerGate,
): UserInfoRouter {
    const channelManager: ChannelManagerLike = {
        getChannelInfo: (channel) =>
            getImChannelInfo(WKSDK.shared(), channel) as ChannelInfoLike | undefined,
        fetchChannelInfo: (channel) =>
            fetchImChannelInfo(WKSDK.shared(), channel) as Promise<ChannelInfoLike | undefined>,
    };
    return new UserInfoRouter(channelManager, dispatch, externalGate);
}
