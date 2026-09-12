import { createReadyReporter, type ReadyReporter } from "../readyReporter";

export interface DesktopPresentationLifecycle<State> {
  /** Tear everything down and stop re-installing. Only needed during app teardown. */
  dispose: () => void;
  /** Resolves once the initial negotiation finishes. True when the adapter is active. */
  available: Promise<boolean>;
  /** Reports current capability and reads page/space from the live context. */
  reportReady: (state: State) => Promise<void>;
}

interface LifecycleOptions<State extends object> {
  install: () => Promise<(() => void) | null>;
  getContext: () => Partial<State>;
  report: (state: State, available: boolean) => Promise<void>;
}

/** Reinstall on bfcache restoration, but preserve the adapter on cancelled unload. */
export function installDesktopLifecycle<State extends object>(
  view: Window,
  options: LifecycleOptions<State>,
): DesktopPresentationLifecycle<State> {
  let disposeActive: (() => void) | null = null;
  let gone = false;
  let baseState: State | null = null;
  let restoreReporter: ReadyReporter | null = null;

  const report = () => {
    if (!baseState || gone) return Promise.resolve();
    return options.report({
      ...baseState,
      ...options.getContext(),
    }, Boolean(disposeActive));
  };

  // Invalidate pending negotiations when the page leaves or another round starts.
  let generation = 0;
  let settle: (supported: boolean) => void = () => undefined;
  const available = new Promise<boolean>(resolve => { settle = resolve; });
  // Release old adapters before installing new ones; both mutate the same DOM.
  let chain: Promise<void> = Promise.resolve();

  const tearDownActive = () => {
    if (!disposeActive) return;
    const tearDown = disposeActive;
    disposeActive = null;
    tearDown();
  };

  const scheduleInstall = () => {
    if (gone) return;
    const seen = ++generation;

    chain = chain.then(async () => {
      try {
        if (gone || seen !== generation) return;
        tearDownActive();
        const dispose = await options.install().catch(() => null);
        if (gone) {
          dispose?.();
          settle(false);
          return;
        }
        if (seen !== generation) {
          dispose?.();
          return;
        }
        disposeActive = dispose ?? null;
        settle(Boolean(dispose));
        if (baseState) {
          restoreReporter?.dispose();
          restoreReporter = createReadyReporter(report);
          restoreReporter.request();
        }
      } catch {
        // A throwing release must never stall the chain for later rounds.
      }
    });
  };

  const onPageHide = () => {
    generation++;
    restoreReporter?.dispose();
    tearDownActive();
    settle(false);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) scheduleInstall();
  };

  view.addEventListener("pagehide", onPageHide);
  view.addEventListener("pageshow", onPageShow);
  scheduleInstall();

  return {
    dispose: () => {
      gone = true;
      generation++;
      restoreReporter?.dispose();
      baseState = null;
      tearDownActive();
      settle(false);
      view.removeEventListener("pagehide", onPageHide);
      view.removeEventListener("pageshow", onPageShow);
    },
    available,
    reportReady: (state) => {
      baseState = state;
      restoreReporter?.dispose();
      return report();
    },
  };
}
