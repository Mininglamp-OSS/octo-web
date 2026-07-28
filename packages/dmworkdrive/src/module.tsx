import React, { useEffect, useState } from 'react';
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
import ShareLandingPage from './pages/ShareLandingPage';
import InviteLandingPage from './pages/InviteLandingPage';

import enUS from './i18n/en-US.json';
import zhCN from './i18n/zh-CN.json';

/** Guard against double-init (HMR in dev or future module lifecycle changes). */
let _initialized = false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
  });
}

// Shared view-model backing both panes (space rail + file view). One instance
// per module load; the `/drive` route factory and the menu's onPress both close
// over it so the two WKViewQueue subtrees stay in sync.
const vm = new DriveVM();

// ─── Deep-link capture for the share / invite landing routes ────────────────
//
// The octo host's self-built RouteManager activates the main view by matching a
// registered menu's routePath; only `/drive` has a menu. A hard navigation to
// `/drive/s/:id` or `/drive/invite/:token` therefore has no menu to activate
// and would fall back to the chat shell. Mirroring the docs module, we capture
// the token on boot, stash it, and rewrite the URL to `/drive` so the existing
// `/drive` menu activates — then DriveRouteElement renders the landing page
// while a pending token exists. RouteManager passes no path params, so the
// token is read from the pathname.

const PENDING_SHARE_KEY = 'octo.drive.pendingShare';
const PENDING_INVITE_KEY = 'octo.drive.pendingInvite';

function shareTokenFromPath(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/\/drive\/s\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function inviteTokenFromPath(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/\/drive\/invite\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Read a pending landing token: live path first, then the stashed value. */
function readPending(key: string, fromPath: () => string): string {
  const live = fromPath();
  if (live) return live;
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Peek whether a landing token is pending, without consuming it. */
function hasPendingLanding(): boolean {
  return !!readPending(PENDING_SHARE_KEY, shareTokenFromPath) ||
    !!readPending(PENDING_INVITE_KEY, inviteTokenFromPath);
}

function clearPending(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore — nothing to clear if storage is unavailable.
  }
}

/**
 * On a cold open of `/drive/s/:id` or `/drive/invite/:token`, stash the token
 * and rewrite the URL to `/drive` so the existing menu activates the view.
 */
function normalizeDriveDeepLink(): void {
  if (typeof window === 'undefined') return;
  const share = shareTokenFromPath();
  const invite = inviteTokenFromPath();
  if (!share && !invite) return;
  try {
    if (share) window.sessionStorage.setItem(PENDING_SHARE_KEY, share);
    if (invite) window.sessionStorage.setItem(PENDING_INVITE_KEY, invite);
  } catch {
    // sessionStorage unavailable: the route element still reads from the path.
  }
  try {
    window.history.replaceState(window.history.state, '', '/drive');
  } catch {
    // history unavailable: leave the URL as-is; path-based read still works.
  }
}

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

/**
 * Element served for the `/drive` menu/route into WKLayout.contentLeft.
 * Renders the share/invite landing page full-width in the left pane when a
 * pending token exists (a normalized deep-link) — landing pages are single
 * pages, not the two-pane split. Otherwise renders the space rail; the file
 * view is mounted separately into the right pane by the menu's onPress.
 *
 * The token is read once and consumed so a later plain `/drive` visit doesn't
 * re-trigger a landing flow; `onExit` clears the token and hands off to the
 * normal two-pane view (rail here + content in the right pane).
 */
function DriveRouteElement(): React.ReactElement {
  const [pending, setPending] = useState(() => ({
    share: readPending(PENDING_SHARE_KEY, shareTokenFromPath),
    invite: readPending(PENDING_INVITE_KEY, inviteTokenFromPath),
  }));

  useEffect(() => {
    if (pending.share) clearPending(PENDING_SHARE_KEY);
    if (pending.invite) clearPending(PENDING_INVITE_KEY);
  }, [pending.share, pending.invite]);

  const exit = () => {
    setPending({ share: '', invite: '' });
    mountDriveContent();
  };

  if (pending.share) return <ShareLandingPage token={pending.share} onExit={exit} />;
  if (pending.invite) return <InviteLandingPage token={pending.invite} onExit={exit} />;
  return <DriveSidebar vm={vm} onActivate={mountDriveContent} />;
}

// Build the `/drive` route element ONCE so the host's repeated route-handler
// invocations preserve the fiber (DriveRouteElement's one-shot token read runs
// once). Mirrors the docs module's docsRouteElement stability contract.
const driveRouteElement = <DriveRouteElement />;

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
 * contentRight, mirroring mcp-market), share/invite landing routes, and a
 * NavRail entry.
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

    // Capture a share/invite deep-link and normalize to `/drive` BEFORE the
    // host reads the route, so the `/drive` menu activates.
    normalizeDriveDeepLink();

    // `/drive` renders the space rail (or a landing page) into contentLeft.
    // hostShell keeps URL-driven renders mounting the full shell (see above).
    WKApp.route.register('/drive', () => driveRouteElement, { hostShell: driveHostShell });
    // Landing routes for in-app SPA navigation. The token is read from the
    // pathname (RouteManager passes no params); cold-loads go through
    // normalizeDriveDeepLink → `/drive` → DriveRouteElement.
    WKApp.route.register('/drive/s/:id', () => <ShareLandingRoute />);
    WKApp.route.register('/drive/invite/:token', () => <InviteLandingRoute />);

    // NavRail entry (sort 4008 — after contacts=4000 / matter=4001 cluster).
    WKApp.menus.register(
      'drive',
      () => {
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
        // the right pane — unless a share/invite deep-link is pending, in which
        // case DriveRouteElement shows the landing page in the left pane and the
        // right pane stays empty until the user exits into the drive.
        m.onPress = () => {
          WKApp.routeLeft.popToRoot();
          if (hasPendingLanding()) {
            WKApp.routeRight.popToRoot();
          } else {
            mountDriveContent();
          }
          WKApp.route.syncPath('/drive');
        };
        return m;
      },
      4008,
    );
  }
}

function ShareLandingRoute(): React.ReactElement {
  return <ShareLandingPage token={shareTokenFromPath()} />;
}

function InviteLandingRoute(): React.ReactElement {
  return <InviteLandingPage token={inviteTokenFromPath()} />;
}
