/**
 * Shared IPC channel name constants.
 *
 * Import this file in both the main process and the renderer / preload so
 * that the string literal is only defined once and typos are caught at
 * compile time rather than silently breaking at runtime.
 */

/** Renderer → Main: sync the current unread-message count to the tray. */
export const IPC_CONVERSATION_UNREAD_COUNT = "conversation-manager-unread-count";

/** Renderer → Main: register the API origin expected for the OIDC callback. */
export const IPC_OIDC_AUTHORIZE_START = "oidc-authorize-start";

/**
 * Renderer → Main: the deep-link IPC listener has attached and any buffered
 * URLs may be flushed. The main process resets its readiness flag on every
 * navigation, so the renderer must re-announce after each shell load.
 */
export const IPC_DEEP_LINK_READY = "deep-link-ready";
