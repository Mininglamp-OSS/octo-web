/**
 * Copy for the fleet trust dialog (unknown-host issue-preview prompt).
 *
 * Main-process native dialogs cannot reach the renderer i18n bundle, so the
 * copy is resolved here from a locale string, mirroring the MIGRATION_DIALOGS
 * pattern in main/index.ts. Pure on purpose: callers pass the resolved
 * locale (typically `app.getLocale()` once `ready`), which keeps this module
 * unit-testable without mocking Electron.
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
    title: "信任此域名以打开任务预览？",
    message: `是否允许在“${host}”下打开任务预览？`,
    detail: `链接：${href}`,
    buttons: ["允许", "拒绝"],
    checkboxLabel: "允许并记住此域名",
  }),
  en: (host, href) => ({
    title: "Trust this domain to open task previews?",
    message: `Allow task previews from “${host}”?`,
    detail: `Link: ${href}`,
    buttons: ["Allow", "Deny"],
    checkboxLabel: "Allow and remember this domain",
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
