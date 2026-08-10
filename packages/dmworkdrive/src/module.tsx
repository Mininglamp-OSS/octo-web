import React from 'react';
import ReactDOM from 'react-dom';
import {
  WKApp,
  ChatPage,
  Menus,
  i18n,
  t as translate,
  MessageContentTypeConst,
  isDriveTransferSupportedChannel,
} from '@octo/base';
import type { IModule } from '@octo/base';
import DriveSidebar from './pages/DriveSidebar';
import DriveContent from './pages/DriveContent';
import { DriveVM, useDriveVM } from './pages/DriveVM';
import { transferFromIm, checkImTransferredBatch, getAncestors } from './api/driveApi';
import type { ImTransferredEntry } from './api/driveApi';
import { imTransferredSourceKey, normaliseImChannelID } from './bridge/types';
import SaveToDriveModal from './ui/SaveToDriveModal';
import { Toast } from './utils/toast';

import enUS from './i18n/en-US.json';
import zhCN from './i18n/zh-CN.json';

/** Guard against double-init (HMR in dev or future module lifecycle changes). */
let _initialized = false;
/** `space-changed` subscription, kept for HMR teardown. */
let _spaceChangedHandler: (() => void) | null = null;
/** `wk:auth-state-changed` subscription, kept for HMR teardown. Bound alongside
 *  `space-changed` so both flush the drive-transferred cache on tenant/user
 *  swaps (see review PR #1322 non-blocking finding: the cache used to survive
 *  identity changes and could feed stale synchronous state to the right-click
 *  menu until the next backend batch overwrote it). */
let _authStateChangedHandler: (() => void) | null = null;
/** remoteConfig (drive_on) listeners, kept so a repeat init drops them before rebinding. */
let _configUnsubscribers: Array<() => void> = [];

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
    if (_spaceChangedHandler) {
      WKApp.mittBus.off('space-changed', _spaceChangedHandler);
      _spaceChangedHandler = null;
    }
    if (_authStateChangedHandler) {
      WKApp.mittBus.off('wk:auth-state-changed', _authStateChangedHandler);
      _authStateChangedHandler = null;
    }
    for (const unsub of _configUnsubscribers) unsub();
    _configUnsubscribers = [];
  });
}

// Shared view-model backing both panes (space rail + file view). One instance
// per module load; the `/drive` route factory and the menu's onPress both close
// over it so the two WKViewQueue subtrees stay in sync.
const vm = new DriveVM();

// ---------------------------------------------------------------------------
// Drive-transferred cache (module-scope singleton, spans FileCell lifetimes).
// ---------------------------------------------------------------------------
// Single source of truth for "has THIS IM file been saved to any drive space
// I can see?" across every entry point (file-card icon, right-click menu,
// picker modal). Keyed by the wire `source_key`
// (channelType#channelID#msgID) so the key matches the backend storage key and
// the request payload without an extra translation step.
//
// Why a module singleton, not React state:
//   - Icon lives inside a FileCell (component state) — one per rendered
//     message. Right-click menu is registered via WKApp.endpoints as a plain
//     factory with no component instance to read state from. Both entry
//     points must agree, and the agreement must survive scroll-out unmounts
//     (the same file scrolls back into view later — the cache prevents a
//     re-batch and prevents a stale "unsaved" flicker on the second mount
//     before the async check resolves).
//   - Cross-cutting event bus (WKApp.mittBus 'wk:drive-transferred-changed')
//     is the fan-out: any write to this cache emits, subscribers (FileCell)
//     setState so their icons and dropdowns update in place.
//
// Design choice: NO "list of locations". Product decision — a chat file is
// either saved (any single canonical winner returned by backend
// LookupBatchAcrossMySpaces' tie-break: personal > freshest shared) or not.
// Existing entry points do not offer "save AGAIN elsewhere" once saved;
// moving/copying is a drive-app concern, not IM's. Simplification comes from
// that product invariant, not a tech shortcut.
type DriveTransferredEntry = { file_id: number; space_id: string; parent_id: number };
type DriveTransferredState =
  | { status: 'unknown' } // never checked or check failed — treat as unsaved for UI
  | { status: 'notfound' } // backend confirmed no drive row
  | { status: 'saved'; entry: DriveTransferredEntry };
const driveTransferredCache = new Map<string, DriveTransferredState>();

// Per-key monotonic write generation. Every write bumps its key's counter;
// `seedDriveCache` refuses to overwrite when the write it was based on
// (the batch RTT it was issued for) is older than a subsequent
// `markDriveSaved`. Without this guard, a save that landed BEFORE a
// pre-save batch RTT resolved would be silently downgraded to `notfound`
// when the batch response arrived, and the right-click menu (which reads
// the cache synchronously via getDriveTransferred) would flip back to
// "存到云盘…" while the icon still shows "在云盘中查看". Reviewer flagged
// this as the stale-seed downgrade race (Octo-Q PR #1322 P2). Note the
// dual constraint: batch-seeded `notfound` MUST still be able to
// overwrite a stale `saved` (that's how drive-side deletes reflect on
// next FileCell mount, per c1f3071d), so a blanket "never downgrade"
// isn't correct. Generation-based ordering is.
const driveWriteGen = new Map<string, number>();

function nextWriteGen(sourceKey: string): number {
  const next = (driveWriteGen.get(sourceKey) ?? 0) + 1;
  driveWriteGen.set(sourceKey, next);
  return next;
}

// Identity epoch — bumped by every tenant / auth change. Each in-flight batch
// captures the epoch at enqueue time; if the response arrives after a
// clear() the epochs disagree and seedDriveCache/waiter resolvers drop the
// stale-identity payload rather than repopulating the fresh session's cache
// with the previous tenant's drive coordinates (Jerry-Xin round-2 blocking
// on PR #1322). Clearing driveTransferredCache alone is not enough — an
// old-identity batch that resolves AFTER the clear would seed right back in.
let driveIdentityEpoch = 0;
function bumpDriveIdentityEpoch(): void {
  driveIdentityEpoch++;
}

function readDriveCache(sourceKey: string): DriveTransferredState {
  return driveTransferredCache.get(sourceKey) ?? { status: 'unknown' };
}

/** Write a `saved` entry into the cache and broadcast the flip. Used by every
 *  save path (icon quick-save, picker save) and by the batch-lookup response
 *  handler. Idempotent: repeated writes with the same entry stay 'saved' and
 *  still emit — a FileCell that mounted after the last emission wouldn't have
 *  received it, so we don't dedupe. Bumps the per-key write gen so later
 *  in-flight batch responses can't overwrite this. */
function markDriveSaved(sourceKey: string, entry: DriveTransferredEntry): void {
  nextWriteGen(sourceKey);
  driveTransferredCache.set(sourceKey, { status: 'saved', entry });
  WKApp.mittBus.emit('wk:drive-transferred-changed', { sourceKey, entry });
}

/** Store the batch-lookup result: `saved` for hits, `notfound` for misses.
 *  Called from flushBatch AFTER the API response — the batch is the primary
 *  cache filler on first render of a chat file list. Emits on a `saved` seed
 *  so any FileCell whose async check landed after another card's cache-hit
 *  render still picks up the answer.
 *
 *  Skips the write if a `markDriveSaved` landed on this key while the batch
 *  RTT was in flight (the `issuedAtGen` argument captures the write-gen at
 *  enqueue time; if the current gen has moved past it a save has since won
 *  and the batch's answer is stale). This preserves the c1f3071d guarantee
 *  that a `notfound` seed CAN overwrite a stale `saved` (drive-side delete
 *  refresh) — the check is generation-based, not "never downgrade". */
function seedDriveCache(sourceKey: string, issuedAtGen: number, entry: ImTransferredEntry | null): void {
  const currentGen = driveWriteGen.get(sourceKey) ?? 0;
  if (currentGen > issuedAtGen) {
    // A markDriveSaved committed after this batch was issued. Drop the
    // seed rather than downgrade the freshly-saved state.
    return;
  }
  nextWriteGen(sourceKey);
  if (entry) {
    const compact: DriveTransferredEntry = {
      file_id: entry.file_id,
      space_id: entry.space_id,
      parent_id: entry.parent_id,
    };
    driveTransferredCache.set(sourceKey, { status: 'saved', entry: compact });
    WKApp.mittBus.emit('wk:drive-transferred-changed', { sourceKey, entry: compact });
  } else {
    driveTransferredCache.set(sourceKey, { status: 'notfound' });
  }
}

// ---------------------------------------------------------------------------
// SaveToDriveModalHost — subscribes to DriveVM so the picker survives cold
// start (user never opened Drive this session → vm.spaces starts empty and
// arrives asynchronously after `loadSpaces()` resolves). Without this
// wrapper the one-shot ReactDOM.render used to snapshot vm.spaces at portal-
// creation time, and post-load list updates never re-rendered the picker —
// the space dropdown stayed empty and Confirm stayed disabled forever
// (Jerry-Xin review 2026-08-10 blocking finding on PR #1322).
//
// Behaviour:
//   - `useDriveVM(vm)` triggers `vm.ensureLoaded()` on mount AND re-renders
//     the host whenever the VM notifies.
//   - Before spaces have arrived, render a small centred spinner in a
//     `<Modal>` shell so the user can still cancel; do NOT render the real
//     picker yet — its Confirm button would be disabled with no explanation.
//   - Once spaces are present, render the real picker with the current
//     activeSpaceId as default (matches vm.ensureLoaded's post-load state).
//
// The host receives the callbacks unchanged from saveMessageToDriveAt; it
// does not know about the race guard, the cache, or the transfer POST.
// ---------------------------------------------------------------------------
interface SaveToDriveModalHostProps {
  vm: DriveVM;
  onClose: () => void;
  onConfirm: (targetSpaceId: string, targetParentId: number) => Promise<boolean>;
}
function SaveToDriveModalHost({ vm, onClose, onConfirm }: SaveToDriveModalHostProps): JSX.Element {
  const live = useDriveVM(vm);
  // Failure state: `listSpaces` failed under cold-start conditions, so
  // `spaces` is [], `spacesLoading` is false, and `spacesError` is set. The
  // earlier version only branched on `spaces.length === 0`, which meant the
  // spinner shell rendered forever with only a `Toast.error` to signal the
  // problem (Octo-Q round-2 P2). Give the user an explicit error card with
  // a Retry action so a transient network blip doesn't dead-end the picker.
  if (live.spaces.length === 0 && live.spacesError) {
    return (
      <SaveToDriveModal
        visible
        spaces={[]}
        defaultSpaceId={null}
        spacesError={live.spacesError}
        onRetry={() => void live.loadSpaces()}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
  }
  if (live.spaces.length === 0) {
    // Cold-start loading shell: spaces haven't arrived yet. The modal shell
    // stays mounted so Cancel is clickable; the host re-renders once
    // vm.notifyListener fires.
    return (
      <SaveToDriveModal
        visible
        spaces={[]}
        defaultSpaceId={null}
        spacesLoading
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <SaveToDriveModal
      visible
      spaces={live.spaces}
      defaultSpaceId={live.activeSpaceId}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

// NOTE: the share (`/drive/s/:token`) and invite (`/drive/invite/:token`)
// landing pages are intercepted by the host Layout (apps/web) as standalone
// pages — both require a signed-in session and bounce through login and back.
// This module no longer captures/rewrites those deep-links; it owns only the
// authenticated two-pane `/drive` view. Keeping a
// single source of truth for the landing routes (the host Layout) avoids the
// double-routing that the old boot-time URL rewrite created.

/** Mount the normal drive file view into the right pane (WKLayout.contentRight). */
function mountDriveContent(): void {
  try {
    WKApp.routeRight.replaceToRoot(<DriveContent vm={vm} />);
  } catch {
    // Right context not wired yet (very early boot): retry on the next tick.
    window.setTimeout(() => {
      try {
        WKApp.routeRight.replaceToRoot(<DriveContent vm={vm} />);
      } catch (retryError) {
        console.error('[drive] failed to mount content pane', retryError);
      }
    }, 0);
  }
}

// `/drive` renders the space rail into WKLayout.contentLeft; the file view is
// mounted separately into the right pane by the menu's onPress. Built ONCE so
// the host's repeated route-handler invocations preserve the fiber.
const driveRouteElement = <DriveSidebar vm={vm} onActivate={mountDriveContent} />;

// URL-driven renders (cold-load / bfcache pageshow / back-forward) mount the
// full Main shell instead of the bare `/drive` sidebar, so refreshing `/drive`
// doesn't collapse the host to a lone rail. The shell's syncMenuFromBrowserPath
// re-activates the drive NavRail entry → the menu onPress below re-mounts the
// right pane. Mirrors mcp-market's marketHostShell (dmworkmcp/module.tsx).
// ChatPage is cast to ComponentType to sidestep a react-17 types quirk (its
// class `render(): ReactNode` isn't assignable to the JSX element signature);
// it's a valid component at runtime — mcp-market renders it the same way.
const ChatShell = ChatPage as unknown as React.ComponentType;
const driveHostShell = () => <ChatShell />;

/** NavRail drive icon — brand color when active, currentColor otherwise. */
function DriveIcon(_props: { active?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16.2341 16.9681H3.76571C3.07886 16.9681 2.51942 16.3275 2.51942 15.5411C2.51942 14.7547 3.07803 14.1141 3.76571 14.1141H16.2341C16.9219 14.1141 17.4813 14.7547 17.4813 15.5411C17.4813 16.3275 16.9218 16.9681 16.2333 16.9681M8.44641 7.50987C8.44646 6.47702 9.28384 5.63975 10.3168 5.63975C11.3496 5.63975 12.187 6.47702 12.187 7.50987C12.8756 7.50987 13.4339 8.06811 13.4339 8.75669C13.4339 9.44518 12.8756 10.0034 12.187 10.0034H8.44553C7.77919 9.97285 7.2546 9.42369 7.2546 8.75669C7.2546 8.08962 7.77919 7.54045 8.44553 7.50987M18.5941 15.1667L16.4715 4.27982C16.3564 3.60427 15.7236 3.08755 14.9468 3.05879H5.05568C4.265 3.08755 3.62086 3.62083 3.52227 4.3121L1.40667 15.1667C1.32636 15.3849 1.27227 15.6135 1.27227 15.8554C1.27227 17.0842 2.38851 18.0809 3.76573 18.0809H16.2341C17.6105 18.0809 18.7277 17.0842 18.7277 15.8554C18.7276 15.6127 18.6736 15.3849 18.5941 15.1667Z" fill="currentColor" />
    </svg>
  );
}

/**
 * DriveModule — registers the network-drive feature into Octo web:
 * an i18n namespace, a two-pane route (space rail in contentLeft + file view in
 * contentRight, mirroring mcp-market), and a NavRail entry. The share/invite
 * landing pages are owned by the host Layout (apps/web), not this module.
 */
export default class DriveModule implements IModule {
  id(): string {
    return 'DriveModule';
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace('drive', {
      'zh-CN': zhCN,
      'en-US': enUS,
    });

    // Right-click on a supported chat file message → "存到云盘…" / "在云盘中查看".
    // Visibility gate FULLY mirrors the file card's icon
    // (dmworkbase/Messages/File/index.tsx isMessagePersisted + display gates):
    // driveOn remoteConfig ON, message is a File, channel type supports
    // drive transfer, server messageID landed, and status===Normal (not
    // Wait/Fail). The handler runs against every registered message type,
    // so these early guards keep the menu list from getting a spurious
    // entry for text/image/reply messages. Once the gates pass we ALSO
    // read the cross-path saved-state cache synchronously
    // (WKApp.getDriveTransferred): a known-saved file offers a "在云盘中查看"
    // jump (no "save again" — issue #1321 Alternatives Considered
    // deliberately rejects a re-save entry: the backend
    // (target_space_id, ref_id) idempotency key silently returns the
    // original row, so a second save into a different folder appears to
    // do nothing). Unknown/notfound falls back to "存到云盘…" via the
    // picker; that unknown branch is only reachable when the mount-time
    // batch hasn't resolved yet, in which case a saved file's icon also
    // still shows "存到云盘" pending the flip.
    WKApp.endpoints.registerMessageContextMenus(
      'contextmenus.driveSave',
      (message) => {
        if (!WKApp.remoteConfig?.driveOn) return null;
        if (message.contentType !== MessageContentTypeConst.file) return null;
        if (!isDriveTransferSupportedChannel(message.channel.channelType)) return null;
        // Full parity with the icon's isMessagePersisted() gate
        // (dmworkbase/Messages/File/index.tsx): the icon requires BOTH a
        // server messageID (send-ack landed) AND status===Normal (not
        // Wait/Fail). The earlier version checked only messageID, so a
        // send-in-flight or send-failed message still offered the menu
        // entry — the backend would then 404 on the empty/foreign
        // im_msg_id. Reviewer yujiawei round-2 P2-4 on PR #1322.
        if (!message.messageID) return null;
        // MessageStatus.Normal === 1 (Wait=0, Normal=1, Fail=2 per
        // wukongimjssdk lib/model.d.ts). Inlined as a numeric literal
        // rather than imported: dmworkdrive doesn't declare `wukongimjssdk`
        // as a dependency (the plugin talks to WKApp / mittBus surfaces only),
        // and adding a runtime import here breaks the isolated web build
        // Rolldown pass ("failed to resolve import 'wukongimjssdk'").
        if (message.status !== 1) return null;
        // Two-state menu: mirror the icon. If the cache says the file is
        // already saved somewhere the caller can reach, offer "在云盘中查看"
        // that jumps to the winner. Otherwise (notfound / unknown) offer
        // the picker. Unknown is treated as "may not be saved" — safer
        // default: never hide the save entry when we don't know.
        const known = WKApp.getDriveTransferred?.({
          im_group_no: message.channel.channelID,
          im_channel_type: message.channel.channelType,
          im_msg_id: message.messageID,
        });
        if (known) {
          return {
            title: translate('drive.contextMenus.viewInDrive'),
            onClick: () => {
              WKApp.openDriveFile?.({
                space_id: known.space_id,
                file_id: known.file_id,
                parent_id: known.parent_id,
              });
            },
          };
        }
        return {
          title: translate('drive.contextMenus.saveToDrive'),
          onClick: () => {
            const save = WKApp.saveMessageToDriveAt;
            if (!save) return;
            void save({
              im_group_no: message.channel.channelID,
              im_channel_type: message.channel.channelType,
              im_msg_id: message.messageID,
            }).catch(() => {
              // Cancel or backend failure: swallow — the picker's inner
              // handler already surfaced the failure via Toast.error and
              // keeps the modal open for retry; a plain cancel is a no-op.
              // Success toasts fire inside onConfirm (see Toast.success on
              // the transferFromIm success path), so this outer .catch has
              // nothing to add.
            });
          },
        };
      },
      100000, // put the entry LAST — dmworkbase uses up to 99999
    );

    // Bridge for the chat file card's "save to Drive" action. Backend accepts
    // an empty target_space_id and defaults to the caller's personal space,
    // so we don't pre-resolve it (one fewer round-trip). Person channelIDs
    // are Space-prefixed in Space deployments (`s<32-hex>_<peer_uid>`) while
    // the drive/octo-server keys on the bare uid — `normaliseImChannelID`
    // strips the prefix for Person and no-ops for Group / CommunityTopic.
    // Callers hand raw `message.channel.channelID`; this is the single
    // normalisation point for the drive-transfer path (see bridge/types).
    WKApp.saveMessageToDrive = async ({ im_group_no, im_channel_type, im_msg_id }: { im_group_no: string; im_channel_type: number; im_msg_id: string }) => {
      const normalised = normaliseImChannelID(im_channel_type, im_group_no);
      // Snapshot the identity epoch BEFORE the POST so a tenant/auth
      // switch mid-flight (space-changed / wk:auth-state-changed → clear
      // + bumpDriveIdentityEpoch) makes this write skip the cache/emit.
      // Otherwise the response would repopulate the fresh session's cache
      // with the previous identity's drive coordinates and mittBus would
      // flip a FileCell to "view in drive" pointing at the old tenant's
      // file — reviewer Jerry-Xin / yujiawei / Octo-Q round-4 P2. The
      // caller still gets the entry back so the icon path's own setState
      // shows optimistic success (they can retry on next mount / refresh
      // if the tenant switch made the drive-side row inaccessible).
      const savedAtEpoch = driveIdentityEpoch;
      const result = await transferFromIm({
        im_group_no: normalised,
        im_channel_type,
        im_msg_id,
        target_space_id: '',
        target_parent_id: 0,
      });
      const entry = { file_id: result.id, space_id: result.space_id, parent_id: result.parent_id };
      // Fan out to the cache + mittBus so the message's own FileCell icon
      // and any other subscribers (e.g. the right-click menu factory next
      // time it opens) all see the saved state without a round-trip —
      // ONLY when the identity hasn't switched during the RTT.
      if (driveIdentityEpoch === savedAtEpoch) {
        const sourceKey = imTransferredSourceKey({
          im_channel_type,
          im_group_no: normalised,
          im_msg_id,
        });
        markDriveSaved(sourceKey, entry);
      }
      return entry;
    };

    // Save-with-picker: same trigger, but the caller wants to choose target
    // space + folder rather than the default personal-space-root fallback.
    // Renders SaveToDriveModal into its own detached DOM node so its inner
    // Semi `<Modal>` is the ONLY modal in the tree — do NOT use
    // WKBase.showGlobalModal here: that helper wraps `body` in another
    // Semi `<Modal>`, and stacking our own Modal inside it produced the
    // "two boxes stacked" bug the owner reported. The picker is a full
    // modal already, so it gets its own portal mount and cleans up on
    // resolve/reject/cancel. Resolves when the user confirms and the
    // transfer POST returns, rejects on cancel or backend failure.
    WKApp.saveMessageToDriveAt = ({ im_group_no, im_channel_type, im_msg_id }: { im_group_no: string; im_channel_type: number; im_msg_id: string }) => {
      return new Promise<{ file_id: number; space_id: string; parent_id: number }>((resolve, reject) => {
        // The host wrapper does its own ensureLoaded via useDriveVM.
        const host = document.createElement('div');
        host.setAttribute('data-role', 'drive-save-modal-host');
        document.body.appendChild(host);
        let settled = false;
        const cleanup = (): void => {
          try {
            ReactDOM.unmountComponentAtNode(host);
          } catch {
            // ignore — component may have already unmounted
          }
          host.remove();
        };
        const done = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          fn();
          cleanup();
        };
        const normalised = normaliseImChannelID(im_channel_type, im_group_no);
        const sourceKey = imTransferredSourceKey({
          im_channel_type,
          im_group_no: normalised,
          im_msg_id,
        });
        // Race guard: if the file was saved via ANOTHER path (icon quick-save
        // in a different tab, or a batch-lookup that just resolved) while
        // this picker was open, don't fire a second transfer. Skip
        // straight to resolve with the cached entry so the caller's happy-
        // path (icon flip + open-drive jump) still runs.
        const cached = readDriveCache(sourceKey);
        if (cached.status === 'saved') {
          done(() => resolve(cached.entry));
          return;
        }
        ReactDOM.render(
          <SaveToDriveModalHost
            vm={vm}
            onClose={() => done(() => reject(new Error('save-to-drive cancelled')))}
            onConfirm={async (targetSpaceId, targetParentId) => {
              // Second race check — the picker was open long enough for
              // another path to win. Behaves like the pre-open guard: use
              // the cached entry, close the modal, don't POST.
              const now = readDriveCache(sourceKey);
              if (now.status === 'saved') {
                done(() => resolve(now.entry));
                return true;
              }
              try {
                // Snapshot the identity epoch BEFORE the POST — same
                // stale-identity guard as saveMessageToDrive; picker
                // sessions can straddle a tenant switch too. See
                // saveMessageToDrive above for the full rationale.
                const savedAtEpoch = driveIdentityEpoch;
                const result = await transferFromIm({
                  im_group_no: normalised,
                  im_channel_type,
                  im_msg_id,
                  target_space_id: targetSpaceId,
                  target_parent_id: targetParentId,
                });
                const entry = { file_id: result.id, space_id: result.space_id, parent_id: result.parent_id };
                if (driveIdentityEpoch !== savedAtEpoch) {
                  // Tenant switched during the transfer POST. Don't
                  // repopulate the fresh session's cache with the old
                  // identity's coordinates, don't emit the fan-out, and
                  // don't toast success (the "saved to drive" claim
                  // would be misleading under the new identity). Silently
                  // resolve the outer promise so the caller's cleanup
                  // still runs; nothing else on the fresh session's UI
                  // was ever wired to this file.
                  done(() => resolve(entry));
                  return true;
                }
                markDriveSaved(sourceKey, entry);
                // Success toast — matches the icon path's Toast.success at
                // dmworkbase/Messages/File/index.tsx (i18n key
                // `base.messageFile.saveToDriveSuccess`) so both entry
                // points give the user the same "yes it landed" signal
                // (Jerry-Xin / yujiawei / Octo-Q round-2: the module.tsx
                // comment used to claim the modal owns success toasts, but
                // no Toast.success actually fired — silence on the happy
                // path was as confusing as the earlier silence on failure).
                Toast.success(translate('drive.toast.saveToDriveSuccess'));
                done(() => resolve(entry));
                return true;
              } catch (err) {
                // Deliberately do NOT reject the outer promise here — the
                // modal stays open for the user to retry (a 403 typically
                // means the picked space's rank changed between listSpaces
                // and the POST). If we rejected, a later successful retry
                // could not fulfil an already-settled promise. Only cancel
                // (onClose above) rejects. Surface the failure inline via
                // toast so the click isn't silent (Jerry-Xin review non-
                // blocking finding on PR #1322).
                const msg = (err as Error)?.message || translate('drive.toast.opFailed');
                Toast.error(msg);
                return false;
              }
            }}
          />,
          host,
        );
      });
    };

    // Synchronous cache probe — see WKApp.getDriveTransferred JSDoc. Right-
    // click menu factory needs a "known-so-far" answer at menu-open time.
    WKApp.getDriveTransferred = ({ im_group_no, im_channel_type, im_msg_id }) => {
      if (!im_group_no || !im_msg_id) return undefined;
      const sourceKey = imTransferredSourceKey({
        im_channel_type,
        im_group_no: normaliseImChannelID(im_channel_type, im_group_no),
        im_msg_id,
      });
      const state = readDriveCache(sourceKey);
      if (state.status === 'saved') return state.entry;
      if (state.status === 'notfound') return null;
      return undefined;
    };

    // Chat file card mount-time check: has this IM file already been transferred?
    // Coalesces the calls that fire from every visible file card into a single
    // batch request. A microtask (not a timer) flushes the batch: React runs a
    // list's file-card componentDidMounts in one synchronous stack, so every
    // triple is enqueued in the same tick and the microtask fires the instant
    // that stack unwinds — one backend hit for the whole screen, no perceptible
    // delay. Returns the drive entry when found, or null when the sourceKey
    // wasn't in the batch response (= not transferred). The sourceKey used to
    // both dedupe pending waiters and read results back mirrors the backend's
    // storage key `${channelType}#${channelID}#${msgID}`.
    let pendingBatch: Map<string, {
      item: { im_group_no: string; im_channel_type: number; im_msg_id: string };
      // Write-gen snapshot at enqueue time. If a save on this same key
      // commits before the batch response returns, the current gen will
      // be > issuedAtGen and seedDriveCache will drop the stale seed.
      issuedAtGen: number;
      // Identity epoch snapshot at enqueue time. Guards against
      // tenant/auth change during the batch RTT — cache is cleared on
      // the switch, but this in-flight response would otherwise repopulate
      // it with the previous tenant's drive coordinates.
      issuedAtEpoch: number;
      waiters: Array<{
        resolve: (v: ImTransferredEntry | null) => void;
        reject: (err: unknown) => void;
      }>;
    }> | null = null;
    let flushScheduled = false;
    const flushBatch = (): void => {
      const batch = pendingBatch;
      pendingBatch = null;
      flushScheduled = false;
      if (!batch || batch.size === 0) return;
      const items = Array.from(batch.values()).map((e) => e.item);
      checkImTransferredBatch(items)
        .then((results) => {
          for (const [key, entry] of batch) {
            // Identity check: if the tenant/user switched during the RTT,
            // this response is answering under the previous identity and
            // MUST NOT populate the fresh session's cache. Resolve the
            // waiter with `null` (safer than throwing — FileCell will
            // simply not flip to saved; a fresh mount under the new
            // identity re-issues the check with the new epoch).
            if (entry.issuedAtEpoch !== driveIdentityEpoch) {
              for (const w of entry.waiters) w.resolve(null);
              continue;
            }
            const found = results[key] ?? null;
            // Fill the module-level cache BEFORE resolving waiters: FileCell
            // resolvers consume the resolved entry directly, but the cache
            // must be up-to-date for concurrent synchronous readers
            // (right-click menu factory via getDriveTransferred) that race
            // with this microtask. Emits on 'saved' via seedDriveCache.
            // The per-key gen check inside seedDriveCache guards against a
            // save that landed while this RTT was in flight.
            seedDriveCache(key, entry.issuedAtGen, found);
            for (const w of entry.waiters) w.resolve(found);
          }
        })
        .catch((err) => {
          for (const entry of batch.values()) {
            for (const w of entry.waiters) w.reject(err);
          }
        });
    };
    WKApp.checkDriveTransferred = (msg: { im_group_no: string; im_channel_type: number; im_msg_id: string }) =>
      new Promise<ImTransferredEntry | null>((resolve, reject) => {
        // Defensive filter: an empty im_msg_id means the message hasn't been
        // ack'd yet (server messageID is written in vm.ts:updateMessageStatus-
        // BySendAck) — the drive backend has nothing to look up and one bad
        // item would fail the whole batch. Return null (= "not transferred")
        // synchronously without enqueueing. FileCell also gates the caller
        // side (isMessagePersisted); this is a second line of defense for
        // any future caller. Same for im_group_no.
        if (!msg.im_group_no || !msg.im_msg_id) {
          resolve(null);
          return;
        }
        // Normalise Space-prefixed Person channelIDs to bare peer uid before
        // building the source_key + sending the wire — the drive backend and
        // octo-server both key on the unprefixed form. See saveMessageToDrive
        // comment and bridge/types.ts `normaliseImChannelID`.
        const item = {
          im_group_no: normaliseImChannelID(msg.im_channel_type, msg.im_group_no),
          im_channel_type: msg.im_channel_type,
          im_msg_id: msg.im_msg_id,
        };
        const sourceKey = imTransferredSourceKey(item);
        // Deliberately NO cache short-circuit here — every FileCell mount
        // must hit the backend so a drive-side delete (or any other tab's
        // save/delete) is reflected on the next entry into a chat window.
        // The cache is a WRITE-THROUGH sink for cross-component broadcast
        // (mittBus + right-click menu's synchronous read), not a read-side
        // freshness gate. Batch coalescing (queueMicrotask below) still
        // dedupes concurrent same-key checks so a screen of messages
        // resolves in one HTTP round-trip.
        if (!pendingBatch) pendingBatch = new Map();
        const existing = pendingBatch.get(sourceKey);
        if (existing) {
          existing.waiters.push({ resolve, reject });
        } else {
          // Snapshot the current write-gen for this key. If a save on this
          // key wins before the batch RTT returns, seedDriveCache will
          // observe (driveWriteGen[key] > issuedAtGen) and drop the seed.
          // Also snapshot the identity epoch so a tenant switch during
          // the RTT invalidates this entry (see flushBatch).
          const issuedAtGen = driveWriteGen.get(sourceKey) ?? 0;
          const issuedAtEpoch = driveIdentityEpoch;
          pendingBatch.set(sourceKey, { item, issuedAtGen, issuedAtEpoch, waiters: [{ resolve, reject }] });
        }
        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(flushBatch);
        }
      });

    // Chat file card "view in drive": switch the NavRail to the drive menu
    // (this is what mounts the LEFT space rail + highlights the entry — the
    // missing piece that left the sidebar on the conversation list), then
    // mount the RIGHT file view and let the VM focus/flash the target file.
    // switchToMenuById intentionally does not popToRoot (shared left stack),
    // and only syncs the route — it does not mount contentRight, so we still
    // call mountDriveContent explicitly. When the file lives in a nested
    // folder (any space, including a shared one — cross-space save-to-drive
    // saves the file at any depth), pass parent_id so DriveVM.focusFile can
    // pull the ancestor chain and rebuild the breadcrumb; parent_id=0/undefined
    // = space root (the personal-space-root case that always worked).
    WKApp.openDriveFile = ({ space_id, file_id, parent_id }: { space_id: string; file_id: number; parent_id?: number }) => {
      WKApp.switchToMenuById?.('drive');
      mountDriveContent();
      void vm.focusFile(space_id, file_id, parent_id);
    };

    // `/drive` renders the space rail into contentLeft. hostShell keeps
    // URL-driven renders mounting the full shell (see above). The share/invite
    // landing routes are owned by the host Layout (apps/web), not registered
    // here — see the note near `vm`.
    WKApp.route.register('/drive', () => driveRouteElement, { hostShell: driveHostShell });

    // NavRail entry (sort 4008 — after contacts=4000 / matter=4001 cluster).
    //
    // Gated by the backend appconfig `drive_on` flag (WKApp.remoteConfig.driveOn):
    // the factory returns the menu only when driveOn is true, else `undefined`
    // (MenusManager filters falsy → the entry hides). Default false (fail-safe):
    // drive is an independent service whose reverse-proxy route (/v1/drive) +
    // object-storage / docs-backend deps must be deployed before the entry is
    // usable — otherwise the backend fail-closes with 503. Ops flips drive_on on
    // once ready. Pure display gate: /v1/drive auth still lives in the drive
    // service. The `/drive` route stays registered regardless. Mirrors
    // DocsModule (docs_on) / LoopModule (dmloop_on).
    WKApp.menus.register(
      'drive',
      () => {
        if (!WKApp.remoteConfig?.driveOn) return undefined;
        const m = new Menus(
          'drive',
          '/drive',
          translate('drive.menu.title'),
          <DriveIcon />,
          <DriveIcon active />,
        );
        // Own both panes on activation (Main/index.tsx's default click handler
        // is bypassed when onPress is defined). The space rail auto-mounts into
        // contentLeft via the `/drive` route; here we mount the file view into
        // the right pane.
        m.onPress = () => {
          WKApp.routeLeft.popToRoot();
          mountDriveContent();
          WKApp.route.syncPath('/drive');
        };
        return m;
      },
      4008,
    );

    // Host Space switch (or in-tab user change) must not leave the drive
    // showing the previous tenant's spaces/breadcrumb while requests already
    // carry the new X-Space-Id. Reset + reload the shared VM. Mirrors the
    // sister modules' `space-changed` subscription (dmworksummary/module.tsx).
    // Also flush the drive-transferred cache — the right-click menu factory
    // reads this synchronously; leaving stale entries survives a tenant
    // swap and can show "在云盘中查看" for a file the new identity does not
    // own. Backend batches will refill on the next FileCell mount.
    // (Jerry-Xin review 2026-08-10 non-blocking finding on PR #1322.)
    _spaceChangedHandler = () => {
      driveTransferredCache.clear();
      driveWriteGen.clear();
      bumpDriveIdentityEpoch();
      vm.reset();
    };
    WKApp.mittBus.on('space-changed', _spaceChangedHandler);

    // Same cache-flush contract, tighter trigger: login/logout/account
    // replacement (`wk:auth-state-changed`). This runs alongside the
    // space-changed handler because the events don't fully overlap — a
    // pure re-auth on the same tenant fires wk:auth-state-changed without
    // space-changed, and we still need a clean cache.
    _authStateChangedHandler = () => {
      driveTransferredCache.clear();
      driveWriteGen.clear();
      bumpDriveIdentityEpoch();
    };
    WKApp.mittBus.on('wk:auth-state-changed', _authStateChangedHandler);

    // appconfig is fetched asynchronously, so at init() driveOn is usually still
    // the default false. Refresh the NavRail whenever drive_on resolves/changes
    // so the entry appears (or disappears) the moment it does. Idempotent rebind:
    // drop any listeners a prior init() bound before re-subscribing, so repeat
    // registration / HMR doesn't stack duplicate refresh closures on the shared
    // remoteConfig singleton. Mirrors DocsModule._configUnsubscribers.
    for (const unsub of _configUnsubscribers) unsub();
    _configUnsubscribers = [];
    const refreshMenus = (): void => WKApp.menus.refresh?.();
    const rc = WKApp.remoteConfig;
    if (rc) {
      // If the first appconfig load already resolved (module inited late),
      // addListener returns a noop — reflect current drive_on now instead.
      if (rc.requestSuccess) {
        refreshMenus();
      } else {
        _configUnsubscribers.push(rc.addListener(refreshMenus));
      }
      // Later toggles (ops flips drive_on after boot) go through the change listener.
      _configUnsubscribers.push(rc.addConfigChangeListener(refreshMenus));
    }
  }
}
