export function requestGuardedMenuChange(
  _currentMenuId: string | undefined,
  nextMenuId: string,
  requestSwitch: (apply: () => void) => boolean,
  apply: () => void
): boolean {
  // Mail owns the guard for its own menu action. The host only needs to guard
  // exits to other modules; wrapping the Mail action here as well would invoke
  // the same composer guard twice.
  if (nextMenuId === "mail") {
    apply();
    return true;
  }
  return requestSwitch(apply);
}

export function requestProgrammaticMenuChange(
  currentMenuId: string | undefined,
  nextMenuId: string,
  requestSwitch: (apply: () => void) => boolean,
  apply: () => void,
  afterSwitch?: () => void
): boolean {
  if (currentMenuId === nextMenuId) {
    return requestSwitch(() => afterSwitch?.());
  }
  return requestGuardedMenuChange(
    currentMenuId,
    nextMenuId,
    requestSwitch,
    () => {
      apply();
      afterSwitch?.();
    }
  );
}

interface BrowserRouteChangeEvent {
  stopImmediatePropagation(): void;
}

export function requestGuardedBrowserRouteChange(
  event: BrowserRouteChangeEvent,
  requestSwitch: (apply: () => void) => boolean,
  restoreCurrentRoute: () => void,
  replayBrowserNavigation: () => void
): boolean {
  let routeRestored = false;
  let proceededSynchronously = false;
  const accepted = requestSwitch(() => {
    if (!routeRestored) {
      proceededSynchronously = true;
      return;
    }
    replayBrowserNavigation();
  });
  if (accepted || proceededSynchronously) return true;

  event.stopImmediatePropagation();
  restoreCurrentRoute();
  routeRestored = true;
  return false;
}
