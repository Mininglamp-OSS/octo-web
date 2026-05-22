import { useState, useEffect, useCallback } from "react";
import WKApp from "../../App";
import {
  getSpaceSetting,
  updateSpaceSetting,
  SpaceSetting,
} from "../../Service/SpaceSettingService";
import VoiceFeedback from "../../Service/VoiceFeedback";
import VoiceService from "../../Service/VoiceService";
import type { VoiceConfig } from "../../Service/VoiceService";

export interface SpaceFeedbackState {
  spaceSetting: SpaceSetting | null;
  loaded: boolean;
  apiAvailable: boolean;
  loadedSpaceId: string | null;
}

const defaultSetting: SpaceSetting = {
  voice_feedback_on: 0,
  voice_feedback_notice_acked: 0,
};

let sharedState: SpaceFeedbackState = {
  spaceSetting: null,
  loaded: false,
  apiAvailable: false,
  loadedSpaceId: null,
};

let sharedVoiceConfig: VoiceConfig | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function getSharedSpaceFeedbackState(): SpaceFeedbackState {
  return sharedState;
}

export function getSharedVoiceConfig(): VoiceConfig | null {
  return sharedVoiceConfig;
}

export function setSharedVoiceConfig(config: VoiceConfig | null) {
  sharedVoiceConfig = config;
  notify();
}

export function setSharedSpaceSetting(setting: SpaceSetting | null, apiAvailable: boolean, spaceId?: string) {
  sharedState = { spaceSetting: setting, loaded: true, apiAvailable, loadedSpaceId: spaceId ?? sharedState.loadedSpaceId };
  notify();
}

export function resetSharedSpaceSetting() {
  sharedState = { spaceSetting: null, loaded: false, apiAvailable: false, loadedSpaceId: null };
  ensureInflightSpaceId = null;
  inflightPromise = null;
  configPromise = null;
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function fetchAndApplySpaceSetting(spaceId: string, feedbackUrl?: string): Promise<void> {
  try {
    const setting = await getSpaceSetting(spaceId);
    if (WKApp.shared.currentSpaceId !== spaceId) return;
    setSharedSpaceSetting(setting, true, spaceId);

    if (feedbackUrl && setting.voice_feedback_on === 1) {
      if (VoiceFeedback.shared()) {
        VoiceFeedback.shared()!.enable(feedbackUrl);
      } else {
        VoiceFeedback.init(feedbackUrl);
      }
    } else if (VoiceFeedback.shared()) {
      VoiceFeedback.shared()!.disable();
    }
  } catch (err: unknown) {
    if (WKApp.shared.currentSpaceId !== spaceId) return;
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      setSharedSpaceSetting(defaultSetting, false, spaceId);
    } else {
      setSharedSpaceSetting({ ...defaultSetting, voice_feedback_on: 0 }, false, spaceId);
    }
  }
}

let ensureInflightSpaceId: string | null = null;
let inflightPromise: Promise<void> | null = null;
let configPromise: Promise<VoiceConfig> | null = null;

export function ensureVoiceFeedbackLoaded(): Promise<void> {
  const spaceId = WKApp.shared.currentSpaceId;
  if (!spaceId) return Promise.resolve();

  if (sharedState.loaded && sharedState.apiAvailable && sharedState.loadedSpaceId === spaceId) return Promise.resolve();

  if (ensureInflightSpaceId === spaceId && inflightPromise) {
    return inflightPromise;
  }

  ensureInflightSpaceId = spaceId;
  inflightPromise = (async () => {
    try {
      if (!configPromise) {
        configPromise = VoiceService.shared.getConfig();
      }
      const config = await configPromise;
      if (WKApp.shared.currentSpaceId !== spaceId) return;

      if (config.feedback_url) {
        setSharedVoiceConfig(config);
        await fetchAndApplySpaceSetting(spaceId, config.feedback_url);
      }
    } catch {
      configPromise = null;
    } finally {
      if (ensureInflightSpaceId === spaceId) {
        ensureInflightSpaceId = null;
        inflightPromise = null;
      }
    }
  })();
  return inflightPromise;
}

export async function toggleVoiceFeedback(
  spaceId: string,
  newValue: number,
  feedbackUrl?: string,
): Promise<void> {
  await updateSpaceSetting(spaceId, { voice_feedback_on: newValue });
  if (newValue === 0) {
    VoiceFeedback.shared()?.disable();
  } else if (feedbackUrl) {
    if (VoiceFeedback.shared()) {
      VoiceFeedback.shared()!.enable(feedbackUrl);
    } else {
      VoiceFeedback.init(feedbackUrl);
    }
  }
}

export async function ackFeedbackNotice(spaceId: string): Promise<void> {
  await updateSpaceSetting(spaceId, { voice_feedback_notice_acked: 1 });
}

export default function useSpaceFeedbackSetting() {
  const [state, setState] = useState(sharedState);
  const [voiceConfig, setVoiceConfig] = useState(sharedVoiceConfig);

  useEffect(() => {
    const handler = () => {
      setState(sharedState);
      setVoiceConfig(sharedVoiceConfig);
    };
    listeners.add(handler);
    handler();
    return () => { listeners.delete(handler); };
  }, []);

  const updateSetting = useCallback((partial: Partial<SpaceSetting>) => {
    if (!sharedState.spaceSetting) return;
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, ...partial },
      sharedState.apiAvailable,
    );
  }, []);

  return {
    spaceSetting: state.spaceSetting,
    loaded: state.loaded,
    apiAvailable: state.apiAvailable,
    voiceConfig,
    updateSetting,
  };
}
