import type { ReactNode } from "react";
import type { RuntimeEnvironment } from "../../Runtime";

export type SettingsCenterCapability = "desktop";
export type SettingsItem = { id: string; labelKey: string; capabilities?: SettingsCenterCapability[] };
export type SettingsGroup = { titleKey: string; items: SettingsItem[] };

export const settingsGroups: SettingsGroup[] = [
  { titleKey: "base.navRail.settingsCenter.group.settings", items: [{ id: "general", labelKey: "base.navRail.settingsCenter.item.general" }, { id: "account", labelKey: "base.navRail.settingsCenter.item.account" }, { id: "notifications", labelKey: "base.navRail.settingsCenter.item.notifications" }, { id: "voice", labelKey: "base.navRail.settingsCenter.item.voice" }] },
  { titleKey: "base.navRail.settingsCenter.group.desktop", items: [{ id: "desktop-behavior", labelKey: "base.navRail.settingsCenter.item.desktopBehavior", capabilities: ["desktop"] }, { id: "downloads", labelKey: "base.navRail.settingsCenter.item.downloads", capabilities: ["desktop"] }] },
  { titleKey: "base.navRail.settingsCenter.group.privacySecurity", items: [{ id: "trusted-domains", labelKey: "base.navRail.settingsCenter.item.trustedDomains", capabilities: ["desktop"] }] },
  { titleKey: "base.navRail.settingsCenter.group.tools", items: [{ id: "shortcuts", labelKey: "base.navRail.settingsCenter.item.shortcuts" }, { id: "devices", labelKey: "base.navRail.settingsCenter.item.devices" }, { id: "about", labelKey: "base.navRail.settingsCenter.item.about" }] },
];

export interface SettingsRegistryContext {
  environment: RuntimeEnvironment;
}

export function getAvailableSettingsGroups(context: SettingsRegistryContext): SettingsGroup[] {
  return settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        (item.capabilities ?? []).every((capability) => capability === "desktop" && context.environment.target === "desktop"),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export type SettingsIconName = SettingsItem["id"];
export type SettingsPageRenderer = (item: SettingsItem) => ReactNode;
