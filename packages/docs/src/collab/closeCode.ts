// WebSocket close-code state machine (frontend-design §7.6 / §10.3).
//
// The ONLY source for auth recovery is the numeric close code (provider 'close' -> event.code).
// This class encapsulates the decision logic with injected side-effects so it can be unit
// tested without a live provider.
//
// Key invariants:
//   - 4401 (expired): refresh the token at most ONCE per auth generation (authGeneration).
//     A second 4401 in the same generation -> disconnect + login (no livelock). The refresh
//     counter is reset ONLY on synced/authenticated (onAuthStable), NEVER on physical connect.
//   - 4403/4404/4409: terminal. Set `terminated` and disconnect; a terminated guard at the top
//     of the switch swallows any later close echo (including 4401/4429/1011) so it can't be
//     treated as a transient reconnect.
//   - 4429: block the provider's built-in immediate reconnect (disconnect) then defer a single
//     reconnect via the one reconnect source (Retry-After). No second parallel timer.
//   - 1011/other: limited backoff reconnect through the single reconnect source.

export interface CloseEvent {
  code: number
  reason?: string
  /** Optional Retry-After (seconds) surfaced by the transport for 4429. */
  retryAfterSeconds?: number
}

export interface CloseCodeActions {
  disposeToken(): void
  connect(): void
  disconnect(): void
  goLogin(): void
  showForbidden(): void
  exitDocument(): void
  showLockedOrArchived(): void
  clearDocCache(): void
  rollbackPending(): void
  /** Drives the SINGLE reconnect source with limited backoff (network blips / 1011). */
  onTransientClose(event: CloseEvent): void
  /** Defers exactly one reconnect through the single source (used by 4429). */
  deferReconnect(opts: { delayMs: number; reason: string }): void
  reportServerError(event: CloseEvent): void
  /** Default backoff delay when Retry-After is absent. */
  backoffDelay(): number
}

export class CloseCodeMachine {
  private terminated = false
  private authGeneration = 0
  private refreshedInThisGen = false

  constructor(private readonly actions: CloseCodeActions) {}

  isTerminated(): boolean {
    return this.terminated
  }

  getAuthGeneration(): number {
    return this.authGeneration
  }

  hasRefreshedInThisGen(): boolean {
    return this.refreshedInThisGen
  }

  /**
   * Call on 'synced' / 'authenticated' only. Advances the generation and clears the
   * per-generation refresh flag. MUST NOT be called on physical connect (WS connect fires
   * before the server's auth rejection — resetting there caused the 4401 refresh livelock).
   */
  onAuthStable(): void {
    this.authGeneration++
    this.refreshedInThisGen = false
  }

  handleClose(event: CloseEvent): void {
    // Terminated guard at the top: once terminal, ignore every later close echo.
    if (this.terminated) return

    switch (event.code) {
      case 4401: // token expired
        if (!this.refreshedInThisGen) {
          this.refreshedInThisGen = true
          this.actions.disposeToken()
          this.actions.connect()
        } else {
          // Already refreshed this generation and still 4401 -> terminal, go to login.
          // Setting terminated here is required so the disconnect's close echo (a non-4401
          // code) does not fall through `default` and trigger a reconnect (livelock-class).
          this.terminated = true
          this.actions.disconnect()
          this.actions.goLogin()
        }
        break

      case 4403: // permanently no access (removed / deleted / role=none)
        this.terminated = true
        this.actions.disconnect()
        this.actions.rollbackPending()
        this.actions.clearDocCache()
        this.actions.showForbidden()
        break

      case 4404: // document not found
        this.terminated = true
        this.actions.disconnect()
        this.actions.clearDocCache()
        this.actions.exitDocument()
        break

      case 4409: // locked / archived
        this.terminated = true
        this.actions.disconnect()
        this.actions.showLockedOrArchived()
        break

      case 4429: // rate limited
        // Block built-in immediate reconnect, then defer ONE reconnect via the single source.
        this.actions.disconnect()
        this.actions.deferReconnect({
          delayMs:
            event.retryAfterSeconds != null
              ? event.retryAfterSeconds * 1000
              : this.actions.backoffDelay(),
          reason: 'rate-limited-4429',
        })
        break

      case 1011: // server error
        this.actions.reportServerError(event)
        this.actions.onTransientClose(event)
        break

      default: // network blips etc. (terminated already handled at top)
        this.actions.onTransientClose(event)
    }
  }
}
