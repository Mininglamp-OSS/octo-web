import React, { useState, useEffect } from 'react';
import { ensureVoiceFeedbackLoaded } from '../MessageInput/useSpaceFeedbackSetting';
import WKApp from '../../App';
import VoiceSettingsPanel from './VoiceSettingsPanel';

export default function NavVoiceSettingsItem() {
  const [panelVisible, setPanelVisible] = useState(false);

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
      <li onClick={(e) => {
        e.stopPropagation();
        setPanelVisible(true);
      }}>
        语音设置
      </li>
      {panelVisible && (
        <VoiceSettingsPanel onClose={() => setPanelVisible(false)} />
      )}
    </>
  );
}
