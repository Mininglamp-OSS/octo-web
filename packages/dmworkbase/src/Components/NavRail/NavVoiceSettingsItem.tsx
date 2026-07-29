import React, { useState, useEffect } from 'react';
import { ensureVoiceFeedbackLoaded } from '../MessageInput/useSpaceFeedbackSetting';
import WKApp from '../../App';
import VoiceSettingsPanel from './VoiceSettingsPanel';
import { useI18n } from '../../i18n';
import { NavFlyoutMenuItem } from './NavFlyout';

export default function NavVoiceSettingsItem() {
  const [panelVisible, setPanelVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    ensureVoiceFeedbackLoaded().catch(() => {});
    const handler = () => {
      ensureVoiceFeedbackLoaded().catch(() => {});
    };
    WKApp.mittBus.on('space-changed', handler);
    return () => {
      WKApp.mittBus.off('space-changed', handler);
    };
  }, []);

  return (
    <>
      <NavFlyoutMenuItem onSelect={() => setPanelVisible(true)}>
        {t("base.navRail.settingsPanel.voiceSettings")}
      </NavFlyoutMenuItem>
      {panelVisible && (
        <VoiceSettingsPanel onClose={() => setPanelVisible(false)} />
      )}
    </>
  );
}
