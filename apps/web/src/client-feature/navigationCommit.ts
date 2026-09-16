import { createReadyReporter, type ReadyReporter } from "./readyReporter";

interface PendingNavigation {
  /** Monotonically increasing identity token returned by start(). */
  id: number;
  navigationId: number;
  pagePending: boolean;
  conversationPending: boolean;
}

/**
 * Shared navigation-commit lifecycle for embedded renderers.
 *
 * The host may attach a positive safe-integer `navigationId` to a navigate
 * command. The renderer acknowledges (via `reportNavigationCommitted`) only
 * after the requested page AND any attached conversation target have genuinely
 * committed to the UI, never immediately after a state update. The latest
 * navigation wins: a newer navigate, suspend, space change, session revocation,
 * or unmount cancels any stale pending commit.
 *
 * The controller is barrier based. `start()` arms optional page and
 * conversation barriers; `pageCommitted()` / `conversationCommitted()` release
 * them as the renderer observes real layout commits. Both barriers must be
 * released before the acknowledgement is sent.
 *
 * Commits are identity-token-gated: `start()` returns a monotonically
 * increasing token, and `pageCommitted()`/`conversationCommitted()` accept
 * the same token. A stale callback after a newer `start()` or `cancel()`
 * cannot accidentally release the barriers of the latest pending navigation.
 */
export class NavigationCommitController {
  private pending: PendingNavigation | undefined;
  private gen = 0;
  private reporter: ReadyReporter | undefined;

  constructor(
    private readonly report: (navigationId: number) => Promise<void>,
  ) {}

  /**
   * Begin tracking a host navigate command. A positive safe-integer
   * `navigationId` arms a pending commit; anything else cancels any stale
   * pending commit but does not arm a new one (legacy behavior).
   *
   * Returns an identity token for the newly armed navigation, or undefined
   * when the input does not arm a new commit.
   */
  start(input: {
    navigationId?: number;
    hasConversation?: boolean;
    pageCommitted?: boolean;
  }): number | undefined {
    this.cancel();
    if (!isPositiveSafeInteger(input.navigationId)) return undefined;
    const id = ++this.gen;
    this.pending = {
      id,
      navigationId: input.navigationId,
      pagePending: !input.pageCommitted,
      conversationPending: Boolean(input.hasConversation),
    };
    this.tryReport();
    return id;
  }

  /**
   * Release the page barrier. Pass the token returned by `start()` so a
   * stale layout-effect callback cannot release the latest pending
   * navigation's barrier.
   */
  pageCommitted(token: number): void {
    const pending = this.matching(token);
    if (!pending) return;
    pending.pagePending = false;
    this.tryReport();
  }

  /**
   * Release the conversation barrier. Pass the token returned by `start()`
   * so a stale callback after supersede/cancel cannot falsely commit.
   */
  conversationCommitted(token: number): void {
    const pending = this.matching(token);
    if (!pending) return;
    pending.conversationPending = false;
    this.tryReport();
  }

  /** Cancel any pending navigation without reporting. */
  cancel(): void {
    this.gen++;
    this.pending = undefined;
    this.reporter?.dispose();
    this.reporter = undefined;
  }

  dispose(): void {
    this.cancel();
  }

  /** Whether the DOM barriers are pending, independent of acknowledgement delivery. */
  get isPending(): boolean {
    return this.pending !== undefined;
  }

  get pendingNavigationId(): number | undefined {
    return this.pending?.navigationId;
  }

  private matching(token: number): PendingNavigation | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    return pending.id === token ? pending : undefined;
  }

  private tryReport(): void {
    const pending = this.pending;
    if (!pending) return;
    if (pending.pagePending || pending.conversationPending) return;
    const capturedGen = this.gen;
    const id = pending.navigationId;
    this.pending = undefined;
    this.reporter = createReadyReporter(
      () => this.gen === capturedGen ? this.report(id) : Promise.resolve(),
      {
        // Keep retries below the host's five-second budget; its reveal deadline still wins.
        maxAttempts: 3,
        attemptTimeoutMs: 750,
        retryDelayMs: 100,
        onExhausted: (error) => {
          if (this.gen === capturedGen) {
            console.error("[NavigationCommit] failed to report commit", error);
          }
        },
      },
    );
    this.reporter.request();
  }
}

/**
 * True when the bridge exposes `reportNavigationCommitted`, allowing the
 * renderer to advertise `navigationCommitVersion: 1` in its readiness report.
 */
export function hasNavigationCommitBridge(
  bridge: {
    reportNavigationCommitted?: (params: { navigationId: number }) => Promise<void>;
  },
): boolean {
  return typeof bridge.reportNavigationCommitted === "function";
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}
