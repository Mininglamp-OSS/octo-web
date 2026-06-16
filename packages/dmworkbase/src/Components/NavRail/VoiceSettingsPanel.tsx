import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Switch, Tooltip, Toast } from '@douyinfe/semi-ui';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import WKModal from '../WKModal';
import useSpaceFeedbackSetting, {
  toggleVoiceFeedback,
  acceptVoiceInput,
  disableVoiceInput,
  setSharedVoiceConfig,
} from '../MessageInput/useSpaceFeedbackSetting';
import VoiceFeedbackNotice from '../MessageInput/VoiceFeedbackNotice';
import WKApp from '../../App';
import VoiceService from '../../Service/VoiceService';
import { useI18n } from '../../i18n';
import WKButton from '../WKButton';
import './VoiceSettingsPanel.css';

interface VoiceSettingsPanelProps {
  onClose: () => void;
}

export default function VoiceSettingsPanel({ onClose }: VoiceSettingsPanelProps) {
  const { spaceSetting, loaded, voiceConfig, apiAvailable, updateSetting } = useSpaceFeedbackSetting();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const spaceIdRef = useRef<string>('');

  const isVoiceEnabled = spaceSetting?.voice_input_enabled === 1;
  const isFeedbackOn = spaceSetting?.voice_feedback_on === 1;

  const privacyUrl = voiceConfig?.feedback_privacy_url;
  const agreementUrl = voiceConfig?.feedback_user_agreement_url;

  const [localEnabled, setLocalEnabled] = useState<boolean>(false);
  const [localTimeoutMs, setLocalTimeoutMs] = useState<string>('');
  const [localProbeUrl, setLocalProbeUrl] = useState<string>('');
  const [localTranscribeUrl, setLocalTranscribeUrl] = useState<string>('');
  const [localConfigLoaded, setLocalConfigLoaded] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const [localDirty, setLocalDirty] = useState(false);
  const [probeTestStatus, setProbeTestStatus] = useState<'idle' | 'loading' | 'success' | 'fail'>('idle');

  useEffect(() => {
    if (!isVoiceEnabled || voiceConfig?.local_enabled === undefined) {
      setLocalConfigLoaded(false);
      return;
    }

    let cancelled = false;
    VoiceService.shared.getLocalConfig().then((cfg) => {
      if (cancelled) return;
      setLocalEnabled(cfg.enabled);
      setLocalTimeoutMs(cfg.timeout_ms != null ? String(cfg.timeout_ms) : '');
      setLocalProbeUrl(cfg.probe_url ?? '');
      setLocalTranscribeUrl(cfg.transcribe_url ?? '');
      setLocalConfigLoaded(true);
      setLocalDirty(false);
    }).catch(() => {
      if (cancelled) return;
      setLocalEnabled(voiceConfig.local_enabled ?? false);
      setLocalTimeoutMs(voiceConfig.local_timeout_ms != null ? String(voiceConfig.local_timeout_ms) : '');
      setLocalProbeUrl(voiceConfig.local_probe_url ?? '');
      setLocalTranscribeUrl(voiceConfig.local_transcribe_url ?? '');
      setLocalConfigLoaded(true);
    });

    return () => { cancelled = true; };
  }, [isVoiceEnabled, voiceConfig?.local_enabled]);

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
        Toast.error(t('base.navRail.voiceSettings.operationFailed'));
      } finally {
        setLoading(false);
      }
    }
  }, [loading, spaceSetting, t, updateSetting]);

  const handleNoticeAccept = useCallback(async (feedbackOn: boolean) => {
    const spaceId = spaceIdRef.current;
    if (!spaceId) return;
    setLoading(true);
    try {
      await acceptVoiceInput(spaceId, feedbackOn);
      setShowNotice(false);
    } catch {
      Toast.error(t('base.navRail.voiceSettings.operationFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      Toast.error(t('base.navRail.voiceSettings.operationFailed'));
    } finally {
      setLoading(false);
    }
  }, [loading, spaceSetting, t, voiceConfig, updateSetting]);

  const handleLocalToggle = useCallback(async (checked: boolean) => {
    if (localSaving) return;
    const prevEnabled = localEnabled;

    setLocalEnabled(checked);
    setLocalSaving(true);

    try {
      await VoiceService.shared.putLocalConfig({ enabled: checked });
      const newConfig = await VoiceService.shared.getConfig();
      setSharedVoiceConfig(newConfig);
    } catch {
      setLocalEnabled(prevEnabled);
      Toast.error(t('base.navRail.voiceSettings.operationFailed'));
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving, localEnabled, t]);

  const handleLocalConfigSave = useCallback(async () => {
    if (localSaving) return;
    setLocalSaving(true);

    const config: { enabled: boolean; timeout_ms?: number; probe_url?: string; transcribe_url?: string } = {
      enabled: localEnabled,
    };
    const timeoutNum = parseInt(localTimeoutMs, 10);
    if (!isNaN(timeoutNum) && timeoutNum > 0) {
      config.timeout_ms = timeoutNum;
    }
    if (localProbeUrl.trim()) {
      config.probe_url = localProbeUrl.trim();
    }
    if (localTranscribeUrl.trim()) {
      config.transcribe_url = localTranscribeUrl.trim();
    }

    try {
      await VoiceService.shared.putLocalConfig(config);
      const newConfig = await VoiceService.shared.getConfig();
      setSharedVoiceConfig(newConfig);
      setLocalDirty(false);
      Toast.success(t('base.navRail.voiceSettings.saved'));
    } catch {
      Toast.error(t('base.navRail.voiceSettings.saveFailed'));
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving, localEnabled, localTimeoutMs, localProbeUrl, localTranscribeUrl, t]);

  const handleLocalConfigReset = useCallback(async () => {
    if (localSaving) return;
    setLocalSaving(true);

    try {
      await VoiceService.shared.resetLocalConfig({ enabled: localEnabled });
      const newConfig = await VoiceService.shared.getConfig();
      setSharedVoiceConfig(newConfig);

      const cfg = await VoiceService.shared.getLocalConfig();
      setLocalEnabled(cfg.enabled);
      setLocalTimeoutMs(cfg.timeout_ms != null ? String(cfg.timeout_ms) : '');
      setLocalProbeUrl(cfg.probe_url ?? '');
      setLocalTranscribeUrl(cfg.transcribe_url ?? '');
      setLocalDirty(false);
      Toast.success(t('base.navRail.voiceSettings.defaultsRestored'));
    } catch {
      Toast.error(t('base.navRail.voiceSettings.operationFailed'));
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving, localEnabled, t]);


  const handleTestProbe = useCallback(async () => {
    if (!localProbeUrl.trim() || probeTestStatus === 'loading') return;
    setProbeTestStatus('loading');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      await fetch(localProbeUrl.trim(), { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      setProbeTestStatus('success');
    } catch {
      setProbeTestStatus('fail');
    }
    setTimeout(() => setProbeTestStatus('idle'), 3000);
  }, [localProbeUrl, probeTestStatus]);

  return (
    <WKModal
      visible
      title={null}
      onCancel={onClose}
      options={{ closeOnEsc: true, maskClosable: true, closable: false }}
      footer={null}
      className="wk-voice-settings-modal"
    >
      <div className="wk-voice-settings">
        {loaded && !apiAvailable && (
          <div className="wk-voice-settings__notice">
            {t('base.navRail.voiceSettings.serviceUnavailable')}
          </div>
        )}

        <div className="wk-voice-settings__row wk-voice-settings__row--primary">
          <span className="wk-voice-settings__label">{t('base.navRail.voiceSettings.transcription')}</span>
          <Switch
            size="small"
            checked={isVoiceEnabled}
            onChange={handleVoiceToggle}
            disabled={loading || !apiAvailable}
          />
        </div>

        {isVoiceEnabled && voiceConfig?.feedback_url && (
          <div className="wk-voice-settings__row">
            <span className="wk-voice-settings__label">
              {t('base.navRail.voiceSettings.feedback')}
              <Tooltip content={t('base.navRail.voiceSettings.feedbackTooltip')}>
                <IconHelpCircle className="wk-voice-settings__help" size="small" />
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

        {isVoiceEnabled && voiceConfig?.local_enabled !== undefined && localConfigLoaded && (
          <>
            <div className="wk-voice-settings__row">
              <span className="wk-voice-settings__label">
                {t('base.navRail.voiceSettings.localTranscription')}
                <Tooltip content={t('base.navRail.voiceSettings.localTranscriptionTooltip')}>
                  <IconHelpCircle className="wk-voice-settings__help" size="small" />
                </Tooltip>
              </span>
              <Switch
                size="small"
                checked={localEnabled}
                onChange={handleLocalToggle}
                disabled={loading || localSaving}
              />
            </div>

            {localEnabled && (
              <div className="wk-voice-settings__local-config">
                <div className="wk-voice-settings__field">
                  <label className="wk-voice-settings__field-label">
                    {t('base.navRail.voiceSettings.localTimeoutMs')}
                  </label>
                  <input
                    type="number"
                    value={localTimeoutMs}
                    placeholder="10000"
                    onChange={(e) => { setLocalTimeoutMs(e.target.value); setLocalDirty(true); }}
                    className="wk-voice-settings__input"
                  />
                </div>
                <div className="wk-voice-settings__field">
                  <label className="wk-voice-settings__field-label">
                    {t('base.navRail.voiceSettings.localProbeUrl')}
                  </label>
                  <input
                    type="url"
                    value={localProbeUrl}
                    placeholder="http://localhost:8787/"
                    onChange={(e) => { setLocalProbeUrl(e.target.value); setLocalDirty(true); }}
                    className="wk-voice-settings__input"
                  />
                  <WKButton
                    size="sm"
                    variant="secondary"
                    onClick={handleTestProbe}
                    disabled={probeTestStatus === 'loading' || !localProbeUrl.trim()}
                    className="wk-voice-settings__test-btn"
                  >
                    {probeTestStatus === 'idle' && t('base.navRail.voiceSettings.testConnection')}
                    {probeTestStatus === 'loading' && t('base.navRail.voiceSettings.testingConnection')}
                    {probeTestStatus === 'success' && t('base.navRail.voiceSettings.connectionSuccess')}
                    {probeTestStatus === 'fail' && t('base.navRail.voiceSettings.connectionFailed')}
                  </WKButton>
                </div>
                <div className="wk-voice-settings__field">
                  <label className="wk-voice-settings__field-label">
                    {t('base.navRail.voiceSettings.localTranscribeUrl')}
                  </label>
                  <input
                    type="url"
                    value={localTranscribeUrl}
                    placeholder="http://localhost:8787/v1/voice/transcribe"
                    onChange={(e) => { setLocalTranscribeUrl(e.target.value); setLocalDirty(true); }}
                    className="wk-voice-settings__input"
                  />
                </div>
                <div className="wk-voice-settings__actions">
                  <WKButton
                    size="sm"
                    variant="secondary"
                    onClick={handleLocalConfigReset}
                    disabled={localSaving}
                  >
                    {t('base.navRail.voiceSettings.restoreDefaults')}
                  </WKButton>
                  <WKButton
                    size="sm"
                    variant="primary"
                    onClick={handleLocalConfigSave}
                    disabled={localSaving || !localDirty}
                  >
                    {t('base.navRail.voiceSettings.save')}
                  </WKButton>
                </div>
              </div>
            )}
          </>
        )}

        {(privacyUrl || agreementUrl) && (
          <div className="wk-voice-settings__links">
            {privacyUrl && (
              <a
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="wk-voice-settings__link"
              >
                {t('base.navRail.voiceSettings.privacyPolicy')}
              </a>
            )}
            {agreementUrl && (
              <a
                href={agreementUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="wk-voice-settings__link"
              >
                {t('base.navRail.voiceSettings.userAgreement')}
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
