/**
 * Copy for the external-link trust dialog (unknown-host open confirmation).
 *
 * Main-process native dialogs cannot reach the renderer i18n bundle, so the
 * copy is resolved here from a locale string, mirroring the MIGRATION_DIALOGS
 * pattern in main/index.ts. Pure on purpose: callers pass the resolved
 * locale (typically `app.getLocale()` once `ready`), which keeps this module
 * unit-testable without mocking Electron.
 *
 * The same dialog serves two contexts:
 *   - plain external links on unknown hosts → "open in browser?" confirm;
 *   - fleet task links on unknown hosts → "open in browser?" confirm too
 *     (the in-app preview only kicks in once the host is trusted).
 * The copy therefore talks about opening the link, with "trust this domain"
 * as the opt-in for skipping future prompts.
 */

export interface FleetTrustDialogCopy {
  title: string;
  message: string;
  detail: string;
  buttons: [string, string];
  checkboxLabel: string;
}

export type FleetTrustDialogCopyFn = (
  host: string,
  href: string,
) => FleetTrustDialogCopy;

const FLEET_TRUST_DIALOG: {
  zh: FleetTrustDialogCopyFn;
  en: FleetTrustDialogCopyFn;
} = {
  zh: (host, href) => ({
    title: "在浏览器中打开链接？",
    message: `是否在浏览器中打开“${host}”的链接？`,
    detail: `链接：${href}`,
    buttons: ["打开", "取消"],
    checkboxLabel: "信任此域名，下次不再询问",
  }),
  en: (host, href) => ({
    title: "Open this link in the browser?",
    message: `Open the link from “${host}” in your browser?`,
    detail: `Link: ${href}`,
    buttons: ["Open", "Cancel"],
    checkboxLabel: "Trust this domain and don't ask again",
  }),
};

/**
 * Resolve the dialog copy for the given locale. Any locale whose primary
 * language is Chinese gets zh; everything else gets en.
 */
export function fleetTrustDialogCopy(
  locale: string,
  host: string,
  href: string,
): FleetTrustDialogCopy {
  const zh = locale.toLowerCase().startsWith("zh");
  return FLEET_TRUST_DIALOG[zh ? "zh" : "en"](host, href);
}
