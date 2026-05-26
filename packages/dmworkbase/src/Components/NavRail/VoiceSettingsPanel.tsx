import React, { useState, useCallback, useRef } from 'react';
import { Switch, Tooltip, Toast } from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import WKModal from '../WKModal';
import useSpaceFeedbackSetting, {
  toggleVoiceFeedback,
  acceptVoiceInput,
  disableVoiceInput,
} from '../MessageInput/useSpaceFeedbackSetting';
import VoiceFeedbackNotice from '../MessageInput/VoiceFeedbackNotice';
import WKApp from '../../App';

interface VoiceSettingsPanelProps {
  onClose: () => void;
}

export default function VoiceSettingsPanel({ onClose }: VoiceSettingsPanelProps) {
  const { spaceSetting, loaded, voiceConfig, apiAvailable, updateSetting } = useSpaceFeedbackSetting();
  const [loading, setLoading] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const spaceIdRef = useRef<string>('');

  const isVoiceEnabled = spaceSetting?.voice_input_enabled === 1;
  const isFeedbackOn = spaceSetting?.voice_feedback_on === 1;

  const privacyUrl = voiceConfig?.feedback_privacy_url;
  const agreementUrl = voiceConfig?.feedback_user_agreement_url;

  const handleVoiceToggle = useCallback(async (checked: boolean) => {
    if (loading) return;
    const spaceId = WKApp.shared.currentSpaceId;
    if (!spaceId) return;

    if (checked) {
      spaceIdRef.current = spaceId;
      setShowNotice(true);
    } else {
      const prevEnabled = spaceSetting?.voice_input_enabled ?? 0;
      const prevFeedback = spaceSetting?.voice_feedback_on ?? 0;
      updateSetting({ voice_input_enabled: 0, voice_feedback_on: 0 });
      setLoading(true);
      try {
        await disableVoiceInput(spaceId);
      } catch {
        updateSetting({ voice_input_enabled: prevEnabled, voice_feedback_on: prevFeedback });
        Toast.error('操作失败，请重试');
      } finally {
        setLoading(false);
      }
    }
  }, [loading, spaceSetting, updateSetting]);

  const handleNoticeAccept = useCallback(async (feedbackOn: boolean) => {
    const spaceId = spaceIdRef.current;
    if (!spaceId) return;
    setLoading(true);
    try {
      await acceptVoiceInput(spaceId, feedbackOn);
      setShowNotice(false);
    } catch {
      Toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFeedbackToggle = useCallback(async (checked: boolean) => {
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

  return (
    <WKModal
      visible
      title="语音设置"
      onCancel={onClose}
      options={{ closeOnEsc: true, maskClosable: true }}
      footer={null}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loaded && !apiAvailable && (
          <div style={{ color: 'var(--semi-color-warning)', fontSize: 13 }}>
            当前服务不可用，无法修改语音设置
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>语音转写</span>
          <Switch
            size="small"
            checked={isVoiceEnabled}
            onChange={handleVoiceToggle}
            disabled={loading || !apiAvailable}
          />
        </div>

        {isVoiceEnabled && voiceConfig?.feedback_url && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              帮助改进语音识别服务
              <Tooltip content="开启后，语音识别数据及修改后的文本将用于改善识别质量。">
                <IconHelpCircle size="small" style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
              </Tooltip>
            </span>
            <Switch
              size="small"
              checked={isFeedbackOn}
              onChange={handleFeedbackToggle}
              disabled={loading || !apiAvailable}
            />
          </div>
        )}

        {(privacyUrl || agreementUrl) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {privacyUrl && (
              <a
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--semi-color-link)', fontSize: 13 }}
              >
                《Octo个人信息保护政策》
              </a>
            )}
            {agreementUrl && (
              <a
                href={agreementUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--semi-color-link)', fontSize: 13 }}
              >
                《Octo 用户服务协议》
              </a>
            )}
          </div>
        )}
      </div>

      {showNotice && (
        <VoiceFeedbackNotice
          onAccept={handleNoticeAccept}
          onCancel={() => setShowNotice(false)}
          feedbackPrivacyUrl={privacyUrl}
          feedbackUserAgreementUrl={agreementUrl}
        />
      )}
    </WKModal>
  );
}
