import React from 'react';
import {
  WKApp,
  ChatPage,
  Menus,
  i18n,
  t as translate,
} from '@octo/base';
import type { IModule } from '@octo/base';
import { HardDrive } from 'lucide-react';
import DriveSidebar from './pages/DriveSidebar';
import DriveContent from './pages/DriveContent';
import { DriveVM } from './pages/DriveVM';
import { transferFromIm, checkImTransferred } from './api/driveApi';

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

// NOTE: the share (`/drive/s/:token`) and invite (`/drive/invite/:token`)
// landing pages are intercepted by the host Layout (apps/web) as standalone
// pages — share renders anonymously (public endpoints, no login), invite
// bounces through login and back. This module no longer captures/rewrites those
// deep-links; it owns only the authenticated two-pane `/drive` view. Keeping a
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
function DriveIcon({ active }: { active?: boolean }) {
  const color = active ? 'var(--wk-brand-primary, #7C5CFC)' : 'currentColor';
  return <HardDrive size={22} color={color} />;
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

    // Bridge for the chat file card's "save to Drive" action. Backend accepts
    // an empty target_space_id and defaults to the caller's personal space,
    // so we don't pre-resolve it (one fewer round-trip).
    WKApp.saveMessageToDrive = async ({ im_group_no, im_msg_id }: { im_group_no: string; im_msg_id: string }) => {
      const result = await transferFromIm({
        im_group_no,
        im_msg_id,
        target_space_id: '',
        target_parent_id: 0,
      });
      return { file_id: result.id, space_id: result.space_id, parent_id: result.parent_id };
    };

    // Chat file card hover-check: has this IM file already been transferred?
    WKApp.checkDriveTransferred = (refId: string) => checkImTransferred(refId);

    // Chat file card "view in drive": open the drive route, ensure the right
    // pane is mounted, and let the VM focus/flash the target file.
    WKApp.openDriveFile = ({ space_id, parent_id, file_id }: { space_id: string; parent_id: number; file_id: number }) => {
      WKApp.routeLeft.popToRoot();
      mountDriveContent();
      WKApp.route.syncPath('/drive');
      vm.focusFile(space_id, parent_id, file_id);
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
