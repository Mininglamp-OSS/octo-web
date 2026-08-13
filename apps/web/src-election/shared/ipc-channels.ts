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

/** Renderer → Main: finish the current OIDC flow and clear its origin lease. */
export const IPC_OIDC_AUTHORIZE_END = "oidc-authorize-end";

/** Renderer → Main: perform a CORS-free OIDC API request in the main process. */
export const IPC_OIDC_HTTP_REQUEST = "oidc-http-request";

/** Renderer → Main: open an IdP URL outside the embedded application window. */
export const IPC_OIDC_OPEN_EXTERNAL = "oidc-open-external";
