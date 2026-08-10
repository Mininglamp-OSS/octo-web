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

// ChannelTypePerson from wukongimjssdk — inlined so this module stays free of
// runtime imports and callers don't need to bring in the sdk barrel just to
// build a source_key.
const CHANNEL_TYPE_PERSON = 1

/**
 * Normalise a channel's raw `channelID` for the drive-transfer wire format:
 * on Person channels strip a leading `s<32-hex>_` Space prefix if present
 * (drive backend + octo-server both key on the bare peer uid); on other
 * channel types return the id unchanged.
 *
 * ⚠️ Uses the SAME regex capture as `normaliseImChannelID` in
 * `packages/dmworkdrive/src/bridge/types.ts` (kept there for wire-contract
 * co-location) — but implemented against the shared `SPACE_PREFIX_RE` so both
 * definitions cannot drift. The two producers of a source_key
 * (FileCell listener in dmworkbase, transferFromIm/checkDriveTransferred in
 * dmworkdrive) MUST both call this same helper and `imDriveTransferSourceKey`
 * so the mittBus fan-out key match holds — divergence here is what the icon
 * ↔ right-click menu unify-state design (PR #1322) is guarding against.
 */
export function normaliseImDriveChannelID(channelType: number, channelID: string): string {
    if (channelType !== CHANNEL_TYPE_PERSON) return channelID
    if (!hasSpacePrefix(channelID)) return channelID
    // stripSpacePrefix uses indexOf('_') so a degenerate `s<32-hex>_` with an
    // empty remainder would return ''; here we prefer to return the original
    // string in that case (matches dmworkdrive/bridge/types.ts regex-capture
    // behaviour where the empty capture group yields undefined and we fall
    // through to the original id). Callers see a bare uid for real inputs
    // and the untouched id for pathological ones.
    const bare = stripSpacePrefix(channelID)
    return bare === '' ? channelID : bare
}

/**
 * Materialise the canonical source_key for an IM → drive transfer:
 * `${channelType}#${normalisedChannelID}#${msgID}`. This is the storage
 * key octo-drive uses on `drive_file.source_key` (see
 * `internal/modules/imtransfer/service.go` `buildSourceKey`) and it doubles
 * as the mittBus fan-out key for `wk:drive-transferred-changed`.
 *
 * ⚠️ This is the ONLY place in octo-web that constructs a source_key.
 * Both FileCell (dmworkbase, listener that flips the icon when a save
 * lands) and dmworkdrive's module.tsx (save/check paths that emit) call
 * this. Do NOT inline `${...}#${...}#${...}` elsewhere — a drift produces
 * a silent failure mode where the fan-out event's key stops matching the
 * subscriber's derived key and the icon stops flipping (which is precisely
 * the bug PR #1322 exists to eliminate).
 *
 * The `channelID` argument may be prefixed; this function normalises via
 * `normaliseImDriveChannelID` before formatting, so callers can hand raw
 * `message.channel.channelID` and get the right key.
 */
export function imDriveTransferSourceKey(
    channelType: number,
    channelID: string,
    msgID: string,
): string {
    return `${channelType}#${normaliseImDriveChannelID(channelType, channelID)}#${msgID}`
}
