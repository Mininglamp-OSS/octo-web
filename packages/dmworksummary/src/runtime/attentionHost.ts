export interface SummaryAttentionRuntimeHost {
  isVisible(): boolean;
  getScopeId(): string;
  getUserId(): string;
  getCurrentSpaceId(): string;
  onSpaceChanged(handler: () => void): () => void;
  onSpaceReady(handler: () => void): () => void;
  onAuthStateChanged(handler: () => void): () => void;
  onMenuActivated(handler: () => void): () => void;
  onVisibilityChanged(handler: () => void): () => void;
  onWindowFocused(handler: () => void): () => void;
  onImMessage?(handler: (message: unknown) => void): () => void;
  onImConnected?(handler: () => void): () => void;
  invalidateWorkbenchAvailability(): void;
  emitSummarySpaceChanged(): void;
}

export interface SummaryAttentionRuntimeScheduler {
  now: () => number;
  setTimeout: (fn: () => void, timeout: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, interval: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface SummaryAttentionRuntimeController {
  init(): void;
  startPolling(): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
