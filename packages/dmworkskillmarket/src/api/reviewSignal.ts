/**
 * A process-wide "the review queue moved" signal.
 *
 * The 组织发布管理 sidebar badge and the 待审核 list are NECESSARILY two different
 * reads: the badge has to show a count while the user is standing on 技能 /
 * 连接器 / 我的发布, i.e. while `ReviewQueue` is not mounted at all, so it cannot
 * be derived from the queue's state. What they can share — and what they did
 * not — is the moment at which both become wrong.
 *
 * That moment is a review MUTATION, so the invalidation is attached to the
 * mutation rather than to its callers (see `api/skillApi.ts`). Wiring it at the
 * call sites instead would mean every present and future decision path — 通过,
 * 拒绝 from the table and from `ReviewDetailDrawer`, 取消审核 from the applicant's
 * own rows in three different market pages, 发布 that opens a review, 下架,
 * deleting a plugin that had a request open — has to remember to poke the
 * sidebar. One of them always forgets.
 *
 * Deliberately NOT `WKApp.mittBus`: the bus is the app-wide channel for things
 * other modules legitimately care about (space switches, nav activation), while
 * this is an internal detail of one package's data layer. Keeping it local also
 * keeps `useReviewRequests` testable without stubbing the global app object.
 *
 * Deliberately NOT a polling interval either: every event that changes this
 * Space's pending count in THIS session goes through the wrapped endpoints
 * below. A decision made by another admin in another browser still needs a
 * reload, which is the pre-existing behaviour and not what was reported.
 */

type ReviewChangeListener = () => void;

const listeners = new Set<ReviewChangeListener>();

/**
 * Announce that the review queue may have changed. Every live
 * `useReviewRequests` re-reads; nothing else happens synchronously.
 *
 * A listener that throws must not stop the others (one broken subscriber would
 * otherwise silently freeze every remaining view), and iteration runs over a
 * copy so a listener unsubscribing during the notify cannot skip its neighbour.
 */
export function notifyReviewsChanged(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (err) {
      console.error("[skill-market] review invalidation listener failed", err);
    }
  }
}

/** Subscribe to review-queue invalidations. Returns the unsubscribe. */
export function subscribeReviewsChanged(
  listener: ReviewChangeListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wrap a mutating endpoint so a successful — or REFUSED — call invalidates the
 * review reads.
 *
 * The refusal case is on purpose: the decision endpoints answer 409 precisely
 * when our copy of the queue is out of date (another admin already approved the
 * request, the author already withdrew it), so a failure is the strongest
 * evidence we have that the badge is stale. Bumping in `finally` cannot loop —
 * listeners only issue reads, and reads never bump.
 */
export function withReviewInvalidation<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    try {
      return await fn(...args);
    } finally {
      notifyReviewsChanged();
    }
  };
}
