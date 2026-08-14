import React, { useState, useEffect } from 'react';
import { ensureVoiceFeedbackLoaded } from '../../features/voice-input/useSpaceFeedbackSetting';
import WKApp from '../../App';
import VoiceSettingsPanel from './VoiceSettingsPanel';
import { useI18n } from '../../i18n';
import { NavFlyoutMenuItem } from './NavFlyout';

export default function NavVoiceSettingsItem() {
  const [panelVisible, setPanelVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let generation = 0;
    let disposed = false;
    const load = () => {
      const requestGeneration = ++generation;
      const spaceId = WKApp.shared?.currentSpaceId ?? '';
      if (!spaceId) return;
      ensureVoiceFeedbackLoaded(
        spaceId,
        () =>
          !disposed &&
          generation === requestGeneration &&
          WKApp.shared?.currentSpaceId === spaceId,
      ).catch(() => {});
    };
    load();
    const handler = () => load();
    WKApp.mittBus.on('space-changed', handler);
    return () => {
      disposed = true;
      generation += 1;
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
