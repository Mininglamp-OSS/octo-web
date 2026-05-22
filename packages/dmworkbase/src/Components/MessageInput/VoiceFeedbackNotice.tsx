import React, { useState, useEffect, useCallback, useRef } from "react";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { ackFeedbackNotice } from "./useSpaceFeedbackSetting";

interface VoiceFeedbackNoticeProps {
  onClose: () => void;
  privacyUrl?: string;
}

const COUNTDOWN_SECONDS = 3;

export default function VoiceFeedbackNotice({
  onClose,
  privacyUrl,
}: VoiceFeedbackNoticeProps) {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const ackedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleAck = useCallback(async () => {
    if (ackedRef.current) return;
    ackedRef.current = true;
    try {
      const spaceId = WKApp.shared.currentSpaceId;
      if (spaceId) {
        await ackFeedbackNotice(spaceId);
      }
      onCloseRef.current();
    } catch {
      ackedRef.current = false;
      Toast.error('确认失败，请重试');
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <WKModal
      visible
      title="语音质量改善计划"
      onCancel={handleAck}
      options={{ maskClosable: false, closeOnEsc: false, closable: false }}
      footer={
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <WKButton variant="primary" onClick={handleAck} disabled={countdown > 0}>
            {countdown > 0 ? `知道了 (${countdown}s)` : "知道了"}
          </WKButton>
          {privacyUrl && (
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: "var(--semi-color-link)" }}
            >
              隐私政策
            </a>
          )}
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--semi-color-text-2)" }}>
        我们会使用您的语音识别数据来改善识别质量。如果您不想参与，可以在 设置 → 语音质量改善计划 中关闭。
      </p>
    </WKModal>
  );
}
