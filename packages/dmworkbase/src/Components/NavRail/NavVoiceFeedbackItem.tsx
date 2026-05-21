import React, { useEffect } from 'react';
import useSpaceFeedbackSetting, { ensureVoiceFeedbackLoaded } from '../MessageInput/useSpaceFeedbackSetting';
import WKApp from '../../App';

interface NavVoiceFeedbackItemProps {
  onClick: () => void;
}

export default function NavVoiceFeedbackItem({ onClick }: NavVoiceFeedbackItemProps) {
  const { apiAvailable } = useSpaceFeedbackSetting();

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

  if (!apiAvailable) return null;

  return <li onClick={onClick}>语音质量改善计划</li>;
}
