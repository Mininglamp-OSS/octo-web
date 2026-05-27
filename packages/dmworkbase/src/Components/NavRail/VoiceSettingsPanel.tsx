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
      Toast.error('操作失败，请重试');
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving, localEnabled]);

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
      Toast.success('已保存');
    } catch {
      Toast.error('保存失败，请重试');
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving, localEnabled, localTimeoutMs, localProbeUrl, localTranscribeUrl]);

  const handleLocalConfigReset = useCallback(async () => {
    if (localSaving) return;
    setLocalSaving(true);

    try {
      await VoiceService.shared.deleteLocalConfig();
      const newConfig = await VoiceService.shared.getConfig();
      setSharedVoiceConfig(newConfig);

      const cfg = await VoiceService.shared.getLocalConfig();
      setLocalEnabled(cfg.enabled);
      setLocalTimeoutMs(cfg.timeout_ms != null ? String(cfg.timeout_ms) : '');
      setLocalProbeUrl(cfg.probe_url ?? '');
      setLocalTranscribeUrl(cfg.transcribe_url ?? '');
      setLocalDirty(false);
      Toast.success('已恢复默认设置');
    } catch {
      Toast.error('操作失败，请重试');
    } finally {
      setLocalSaving(false);
    }
  }, [localSaving]);

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

        {isVoiceEnabled && voiceConfig?.local_enabled !== undefined && localConfigLoaded && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                本地语音识别
                <Tooltip content="开启后，语音识别请求将优先尝试本地部署的 ASR 服务（需本地服务可达）。">
                  <IconHelpCircle size="small" style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
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
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                padding: '12px', marginTop: 4,
                background: 'var(--semi-color-fill-0)',
                borderRadius: 6, fontSize: 13,
              }}>
                <div>
                  <div style={{ marginBottom: 4, color: 'var(--semi-color-text-2)' }}>
                    超时时间 (ms)
                  </div>
                  <input
                    type="number"
                    value={localTimeoutMs}
                    placeholder="10000"
                    onChange={(e) => { setLocalTimeoutMs(e.target.value); setLocalDirty(true); }}
                    style={{
                      width: '100%', padding: '6px 8px',
                      border: '1px solid var(--semi-color-border)',
                      borderRadius: 4, fontSize: 13,
                    }}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4, color: 'var(--semi-color-text-2)' }}>
                    探测地址
                  </div>
                  <input
                    type="url"
                    value={localProbeUrl}
                    placeholder="http://localhost:8787/"
                    onChange={(e) => { setLocalProbeUrl(e.target.value); setLocalDirty(true); }}
                    style={{
                      width: '100%', padding: '6px 8px',
                      border: '1px solid var(--semi-color-border)',
                      borderRadius: 4, fontSize: 13,
                    }}
                  />
                  <button
                    onClick={handleTestProbe}
                    disabled={probeTestStatus === 'loading' || !localProbeUrl.trim()}
                    style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}
                  >
                    {probeTestStatus === 'idle' && '测试连接'}
                    {probeTestStatus === 'loading' && '测试中...'}
                    {probeTestStatus === 'success' && '✅ 连接成功'}
                    {probeTestStatus === 'fail' && '❌ 连接失败'}
                  </button>
                </div>
                <div>
                  <div style={{ marginBottom: 4, color: 'var(--semi-color-text-2)' }}>
                    转写地址
                  </div>
                  <input
                    type="url"
                    value={localTranscribeUrl}
                    placeholder="http://localhost:8787/v1/voice/transcribe"
                    onChange={(e) => { setLocalTranscribeUrl(e.target.value); setLocalDirty(true); }}
                    style={{
                      width: '100%', padding: '6px 8px',
                      border: '1px solid var(--semi-color-border)',
                      borderRadius: 4, fontSize: 13,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={handleLocalConfigReset}
                    disabled={localSaving}
                    style={{
                      padding: '4px 12px', fontSize: 13, borderRadius: 4,
                      border: '1px solid var(--semi-color-border)',
                      background: 'transparent', cursor: 'pointer',
                    }}
                  >
                    恢复默认
                  </button>
                  <button
                    onClick={handleLocalConfigSave}
                    disabled={localSaving || !localDirty}
                    style={{
                      padding: '4px 12px', fontSize: 13, borderRadius: 4,
                      border: 'none', color: '#fff',
                      background: localDirty ? 'var(--semi-color-primary)' : 'var(--semi-color-disabled-bg)',
                      cursor: localDirty ? 'pointer' : 'not-allowed',
                    }}
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </>
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
