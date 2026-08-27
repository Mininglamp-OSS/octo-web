import React from "react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { t } from "../../i18n";
import { createTrustedDomainsAdapter } from "../../Runtime/adapters";
import type { RuntimeEnvironment } from "../../Runtime";
import { SettingsRow } from "./settingsPages";

export interface TrustedDomainsSettingsPageProps {
  environment: RuntimeEnvironment;
}

export default function TrustedDomainsSettingsPage({ environment }: TrustedDomainsSettingsPageProps) {
  const adapter = React.useMemo(() => createTrustedDomainsAdapter(environment), [environment]);
  const [hosts, setHosts] = React.useState<string[] | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setHosts(null);
    if (!adapter) return () => { active = false; };
    void adapter.get().then((next) => {
      if (active) setHosts(Array.isArray(next) ? next : []);
    }).catch(() => {
      if (active) {
        setHosts([]);
        Toast.error(t("base.navRail.settingsCenter.trustedDomains.loadFailed"));
      }
    });
    return () => { active = false; };
  }, [adapter]);

  const remove = async (host: string) => {
    if (!adapter || removing) return;
    setRemoving(host);
    try {
      const next = await adapter.remove(host);
      setHosts(Array.isArray(next) ? next : []);
    } catch {
      Toast.error(t("base.navRail.settingsCenter.trustedDomains.removeFailed"));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="wk-settings-center__page">
      <header className="wk-settings-center__page-header">
        <h2>{t("base.navRail.settingsCenter.page.trustedDomains.title")}</h2>
        <p>{t("base.navRail.settingsCenter.page.trustedDomains.description")}</p>
      </header>
      <section className="wk-settings-center__section-content">
        <section className="wk-settings-center__settings-section">
          <h3>{t("base.navRail.settingsCenter.section.trustedDomains")}</h3>
          {!adapter ? (
            <div className="wk-settings-center__trusted-domains-status">{t("base.navRail.settingsCenter.trustedDomains.unavailable")}</div>
          ) : hosts === null ? (
            <div className="wk-settings-center__trusted-domains-status" aria-busy="true"><Spin /></div>
          ) : hosts.length === 0 ? (
            <div className="wk-settings-center__trusted-domains-empty">{t("base.navRail.settingsCenter.trustedDomains.empty")}</div>
          ) : (
            <div className="wk-settings-center__trusted-domains-list">
              {hosts.map((host) => (
                <SettingsRow
                  key={host}
                  title={host}
                  description={t("base.navRail.settingsCenter.trustedDomains.hostDescription")}
                  trailing={<button type="button" className="wk-settings-center__manage-button" disabled={removing !== null} onClick={() => { void remove(host); }}>{t("base.navRail.settingsCenter.action.remove")}</button>}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
