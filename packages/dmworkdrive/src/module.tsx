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
import { DriveVM } from './pages/DriveVM';
import { transferFromIm, checkImTransferredBatch, getAncestors } from './api/driveApi';
import type { ImTransferredEntry } from './api/driveApi';
import { imTransferredSourceKey, normaliseImChannelID } from './bridge/types';
import SaveToDriveModal from './ui/SaveToDriveModal';

import enUS from './i18n/en-US.json';
import zhCN from './i18n/zh-CN.json';

/** Guard against double-init (HMR in dev or future module lifecycle changes). */
let _initialized = false;
/** `space-changed` subscription, kept for HMR teardown. */
let _spaceChangedHandler: (() => void) | null = null;
/** remoteConfig (drive_on) listeners, kept so a repeat init drops them before rebinding. */
let _configUnsubscribers: Array<() => void> = [];

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
    if (_spaceChangedHandler) {
      WKApp.mittBus.off('space-changed', _spaceChangedHandler);
      _spaceChangedHandler = null;
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

function readDriveCache(sourceKey: string): DriveTransferredState {
  return driveTransferredCache.get(sourceKey) ?? { status: 'unknown' };
}

/** Write a `saved` entry into the cache and broadcast the flip. Used by every
 *  save path (icon quick-save, picker save) and by the batch-lookup response
 *  handler. Idempotent: repeated writes with the same entry stay 'saved' and
 *  still emit — a FileCell that mounted after the last emission wouldn't have
 *  received it, so we don't dedupe. */
function markDriveSaved(sourceKey: string, entry: DriveTransferredEntry): void {
  driveTransferredCache.set(sourceKey, { status: 'saved', entry });
  WKApp.mittBus.emit('wk:drive-transferred-changed', { sourceKey, entry });
}

/** Store the batch-lookup result: `saved` for hits, `notfound` for misses.
 *  Called from flushBatch AFTER the API response — the batch is the primary
 *  cache filler on first render of a chat file list. Emits on a `saved` seed
 *  so any FileCell whose async check landed after another card's cache-hit
 *  render still picks up the answer. */
function seedDriveCache(sourceKey: string, entry: ImTransferredEntry | null): void {
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
    // Same visibility gate as the file card's icon (see Messages/File): driveOn
    // remoteConfig ON, message is a File, channel type supports drive transfer.
    // The registered handler runs on EVERY registered message type, so an
    // early type-guard return keeps the menu list from getting a spurious
    // entry for text/image/reply messages. There's a small window between
    // mount and the transferred-state batch resolving where imTransferred is
    // unknown — the message class holds that state, not this factory, so
    // this handler defaults to the "存到云盘…" label + saveMessageToDriveAt
    // path when it can't see the resolved state; the icon path continues to
    // paint the two-state resolution in the message body regardless. In
    // practice the user right-clicking a file they SAVED already went via
    // the icon at least once — clicking the menu item's "存到云盘…" is a
    // deliberate "save AGAIN into a different space", which is legal
    // (drive dedupes per space) and consistent with the picker's semantics.
    WKApp.endpoints.registerMessageContextMenus(
      'contextmenus.driveSave',
      (message) => {
        if (!WKApp.remoteConfig?.driveOn) return null;
        if (message.contentType !== MessageContentTypeConst.file) return null;
        if (!isDriveTransferSupportedChannel(message.channel.channelType)) return null;
        if (!message.messageID) return null; // unsent / send-ack pending
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
              // Cancel or backend failure: swallow — the picker's inner catch
              // already left the modal open on failure; a plain cancel is a
              // no-op. Toasts on success live inside the modal's onConfirm
              // path (FileCell's existing success path also toasts when the
              // icon triggers save, but the picker owns its own UX).
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
      // time it opens) all see the saved state without a round-trip.
      const sourceKey = imTransferredSourceKey({
        im_channel_type,
        im_group_no: normalised,
        im_msg_id,
      });
      markDriveSaved(sourceKey, entry);
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
        // Ensure vm.spaces is loaded before the picker opens — the modal
        // takes the space list as a prop and expects it non-empty. The
        // picker also gates rank on viewer_role, which only exists on the
        // list response; a stale vm.spaces would gate wrong.
        vm.ensureLoaded();
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
          <SaveToDriveModal
            visible
            spaces={vm.spaces}
            defaultSpaceId={vm.activeSpaceId}
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
                const result = await transferFromIm({
                  im_group_no: normalised,
                  im_channel_type,
                  im_msg_id,
                  target_space_id: targetSpaceId,
                  target_parent_id: targetParentId,
                });
                const entry = { file_id: result.id, space_id: result.space_id, parent_id: result.parent_id };
                markDriveSaved(sourceKey, entry);
                done(() => resolve(entry));
                return true;
              } catch (err) {
                // Leave the modal open so the user can retry / choose a
                // different target — a 403 here means they picked a space
                // the backend refused (rank changed between listSpaces and
                // the POST); the picker still shows the same list. The
                // caller's outer .catch swallows the reject, so surfacing
                // it here doesn't spam the console.
                reject(err);
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
            const found = results[key] ?? null;
            // Fill the module-level cache BEFORE resolving waiters: FileCell
            // resolvers will call readDriveCache to decide setState, so the
            // seed must land first. Emits on 'saved' via seedDriveCache.
            seedDriveCache(key, found);
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
        // Cache short-circuit: an earlier batch/save already gave us the
        // answer. Re-resolve synchronously (well, next microtask via the
        // Promise) without hitting the backend or enqueueing. This is what
        // keeps FileCell re-mounts (scroll-out → scroll-in) from spending a
        // round-trip per re-appearance.
        const cached = readDriveCache(sourceKey);
        if (cached.status === 'saved') {
          resolve({ ...cached.entry } as ImTransferredEntry);
          return;
        }
        if (cached.status === 'notfound') {
          resolve(null);
          return;
        }
        if (!pendingBatch) pendingBatch = new Map();
        const existing = pendingBatch.get(sourceKey);
        if (existing) {
          existing.waiters.push({ resolve, reject });
        } else {
          pendingBatch.set(sourceKey, { item, waiters: [{ resolve, reject }] });
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
    _spaceChangedHandler = () => vm.reset();
    WKApp.mittBus.on('space-changed', _spaceChangedHandler);

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
