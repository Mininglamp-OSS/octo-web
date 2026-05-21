import React, { useState, useCallback } from "react";
import { Switch, Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKApp from "../../App";
import useSpaceFeedbackSetting, {
  toggleVoiceFeedback,
} from "../MessageInput/useSpaceFeedbackSetting";

interface VoiceFeedbackSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function VoiceFeedbackSettingsModal({
  visible,
  onClose,
}: VoiceFeedbackSettingsModalProps) {
  const { spaceSetting, voiceConfig, updateSetting } = useSpaceFeedbackSetting();
  const [loading, setLoading] = useState(false);

  const isOn = spaceSetting?.voice_feedback_on === 1;

  const handleToggle = useCallback(async (checked: boolean) => {
    if (loading) return;
    const newValue = checked ? 1 : 0;
    const prevValue = spaceSetting?.voice_feedback_on ?? 1;

    updateSetting({ voice_feedback_on: newValue });
    setLoading(true);

    try {
      const spaceId = WKApp.shared.currentSpaceId;
      if (!spaceId) throw new Error("no space");
      await toggleVoiceFeedback(spaceId, newValue, voiceConfig?.feedback_url);
    } catch {
      updateSetting({ voice_feedback_on: prevValue });
      Toast.error("操作失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [loading, spaceSetting, voiceConfig, updateSetting]);

  const privacyUrl = voiceConfig?.feedback_privacy_url;

  return (
    <WKModal
      visible={visible}
      title="语音质量改善计划"
      onCancel={onClose}
      footer={null}
    >
      <div style={{ padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: "rgba(28,28,35,0.9)" }}>语音质量改善计划</span>
          <Switch
            checked={isOn}
            onChange={handleToggle}
            disabled={loading}
          />
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "rgba(28,28,35,0.55)" }}>
          开启后，语音识别结果将用于改善识别质量。
        </p>
        {privacyUrl && (
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "var(--semi-color-link)" }}
          >
            隐私政策
          </a>
        )}
      </div>
    </WKModal>
  );
}
