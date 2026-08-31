/**
 * Shared IPC channel name constants.
 *
 * Import this file in both the main process and the renderer / preload so
 * that the string literal is only defined once and typos are caught at
 * compile time rather than silently breaking at runtime.
 */

/** Renderer → Main: sync the current unread-message count to the tray. */
export const IPC_CONVERSATION_UNREAD_COUNT = "conversation-manager-unread-count";

/** Renderer ↔ Main: persist and apply the Desktop keep-awake preference. */
export const IPC_KEEP_AWAKE_GET = "keep-awake-get";
export const IPC_KEEP_AWAKE_SET = "keep-awake-set";

/** Renderer ↔ Main: persist and apply Desktop application behavior settings. */
export const IPC_DESKTOP_SETTINGS_GET = "desktop-settings-get";
export const IPC_DESKTOP_SETTINGS_SET = "desktop-settings-set";
export const IPC_DOWNLOAD_SETTINGS_GET = "download-settings-get";
export const IPC_DOWNLOAD_SETTINGS_SET = "download-settings-set";
export const IPC_DOWNLOAD_DIRECTORY_CHOOSE = "download-directory-choose";
export const IPC_DOWNLOAD_URL = "download-url";
export const IPC_DOWNLOAD_STATUS = "download-status";
export const IPC_OPEN_SYSTEM_SETTINGS = "open-system-settings";

/** Renderer → Main: desktop system capabilities. */
export const IPC_SCREENSHOTS_START = "screenshots-start";
export const IPC_SCREENSHOTS_OK = "screenshots-ok";
export const IPC_MEDIA_ACCESS_STATUS = "get-media-access-status";
export const IPC_RESTART_APP = "restart-app";
export const IPC_QUIT_APP = "quit-app";

/** Renderer → Main: check, download, and install app updates. */
export const IPC_UPDATE_CHECK = "check-update";
export const IPC_UPDATE_DOWNLOAD = "update-app";
export const IPC_UPDATE_CANCEL_DOWNLOAD = "cancel-update-download";

/** Main → Renderer: app update lifecycle. */
export const IPC_UPDATE_ERROR = "update-error";
export const IPC_UPDATE_AVAILABLE = "update-available";
export const IPC_UPDATE_NOT_AVAILABLE = "update-not-available";
export const IPC_UPDATE_DOWNLOAD_PROGRESS = "download-progress";
export const IPC_UPDATE_DOWNLOADED = "update-downloaded";

/** Main → Renderer: desktop navigation events. */
export const IPC_DEEP_LINK = "deep-link";
export const IPC_SHOW_CONVERSATIONS = "show-conversations";

/** Renderer → Main: native notification lifecycle. */
export const IPC_NOTIFICATION_SHOW = "show-native-notification";
export const IPC_NOTIFICATION_CLOSE = "close-native-notification";
export const IPC_NOTIFICATION_CLOSE_ALL = "close-all-native-notifications";
export const IPC_NOTIFICATION_TEST_ICON = "test-notification-icon";

/** Main → Renderer: native notification user interactions. */
export const IPC_NOTIFICATION_CLICKED = "notification-clicked";
export const IPC_NOTIFICATION_ACTION_CLICKED = "notification-action-clicked";

/** Renderer → Main: query the real BrowserWindow focus state. */
export const IPC_WINDOW_IS_FOCUSED = "is-window-focused";

/** Renderer → Main: list and remove user-managed trusted domains. */
export const IPC_TRUSTED_DOMAINS_GET = "trusted-domains-get";
export const IPC_TRUSTED_DOMAIN_REMOVE = "trusted-domain-remove";

/** Renderer → Main: confirm trusting an unknown fleet host for issue previews. */
export const IPC_ASK_TRUST_FLEET_HOST = "fleet:ask-trust-host";

/**
 * Renderer → Main: open an arbitrary http(s) URL in the system browser.
 *
 * Distinct from IPC_OIDC_OPEN_EXTERNAL (which is an end-session-specific,
 * hidden-window flow with an OIDC origin allowlist): this bridge is the
 * generic external-link escape hatch for shell features whose web-era code
 * used window.open + about:blank (realname verification, global search doc
 * open). http(s) only — other schemes are rejected so an attacker-chosen
 * protocol string never reaches the OS handler registry.
 */
export const IPC_OPEN_EXTERNAL_URL = "octo:open-external-url";

/** Renderer → Main: register the API origin expected for the OIDC callback. */
export const IPC_OIDC_AUTHORIZE_START = "oidc-authorize-start";

/** Renderer → Main: finish the current OIDC flow and clear its origin lease. */
export const IPC_OIDC_AUTHORIZE_END = "oidc-authorize-end";

/** Renderer → Main: perform a CORS-free OIDC API request in the main process. */
export const IPC_OIDC_HTTP_REQUEST = "oidc-http-request";

/** Renderer → Main: open an IdP URL outside the embedded application window. */
export const IPC_OIDC_OPEN_EXTERNAL = "oidc-open-external";

/** Renderer → Main: clear authentication cookies and the session auth cache. */
export const IPC_OIDC_CLEAR_AUTH_SESSION = "octo:oidc:clear-auth-session";
