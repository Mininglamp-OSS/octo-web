// Matches Space-prefixed IDs: s + 32-char hex spaceId + underscore
const SPACE_PREFIX_RE = /^s[0-9a-f]{32}_/

export function hasSpacePrefix(id: string): boolean {
    return SPACE_PREFIX_RE.test(id)
}

/**
 * Strip the `s<32-hex>_` Space prefix from a channelID that carries it, so a
 * caller can hand the bare identifier to backends that key on the unprefixed
 * form (peer uid for Person, group_no for Group, etc.). Returns the input
 * unchanged when no prefix is present.
 *
 * Historically lived file-locally in `Service/ChannelSettingService.ts`; moved
 * here to sit next to `hasSpacePrefix` so every call site normalises the same
 * way. See #1261 review round 6 P1-1 for the DM save-to-drive failure that
 * happens without this step.
 */
export function stripSpacePrefix(id: string): string {
    if (!hasSpacePrefix(id)) {
        return id
    }
    return id.substring(id.indexOf("_") + 1)
}

/**
 * The three channelTypes the IM-to-drive transfer feature contracts to
 * support (Person=1, Group=2, CommunityTopic=5). Rendering the
 * "Save to Drive" affordance on any other channelType (e.g.
 * `ChannelTypeCustomerService = 3`) results in a backend 404 with no UI
 * signal that the action was never meant to render there.
 *
 * The set MUST stay in sync with the octo-drive backend routing at
 * `internal/octoserver/client.go` `imMessageURL` (which switches on the
 * same three types) and the wire contract in
 * `packages/dmworkdrive/src/bridge/types.ts`; #1261 review round 6 P1-3.
 *
 * Kept here in @octo/base so FileCell (dmworkbase) can gate without pulling
 * in a dmworkdrive import (the dependency runs base ← drive, not the reverse).
 */
export function isDriveTransferSupportedChannel(channelType: number): boolean {
    return channelType === 1 || channelType === 2 || channelType === 5
}
