import React, { useEffect, useState, useCallback } from 'react';
import { Switch, Tooltip, Toast } from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import useSpaceFeedbackSetting, {
  ensureVoiceFeedbackLoaded,
  toggleVoiceFeedback,
} from '../MessageInput/useSpaceFeedbackSetting';
import WKApp from '../../App';

export default function NavVoiceFeedbackItem() {
  const { spaceSetting, voiceConfig, apiAvailable, updateSetting } = useSpaceFeedbackSetting();
  const [loading, setLoading] = useState(false);

  const isOn = spaceSetting?.voice_feedback_on === 1;

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

  const handleToggle = useCallback(async (checked: boolean) => {
    if (loading) return;
    const newValue = checked ? 1 : 0;
    const prevValue = spaceSetting?.voice_feedback_on ?? 0;

    updateSetting({ voice_feedback_on: newValue });
    setLoading(true);

    try {
      const spaceId = WKApp.shared.currentSpaceId;
      if (!spaceId) throw new Error('no space');
      await toggleVoiceFeedback(spaceId, newValue, voiceConfig?.feedback_url);
    } catch {
      updateSetting({ voice_feedback_on: prevValue });
      Toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [loading, spaceSetting, voiceConfig, updateSetting]);

  if (!apiAvailable || !voiceConfig?.feedback_url) return null;

  const privacyUrl = voiceConfig?.feedback_privacy_url;

  return (
    <>
      <li onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          语音质量改善计划
          <Tooltip content="开启后，语音识别结果将用于改善识别质量。">
            <IconHelpCircle size="small" style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Switch size="small" checked={isOn} onChange={handleToggle} disabled={loading} />
      </li>
      {privacyUrl && (
        <li onClick={() => window.open(privacyUrl, '_blank', 'noopener,noreferrer')}>
          隐私协议
        </li>
      )}
    </>
  );
}
