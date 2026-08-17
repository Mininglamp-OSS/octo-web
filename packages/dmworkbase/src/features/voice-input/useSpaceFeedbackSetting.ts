import { useState, useEffect, useCallback } from "react";
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
  voice_input_enabled: 0,
};

let sharedState: SpaceFeedbackState = {
  spaceSetting: null,
  loaded: false,
  apiAvailable: false,
  loadedSpaceId: null,
};

let sharedVoiceConfig: VoiceConfig | null = null;
const listeners = new Set<() => void>();
let configPromise: Promise<VoiceConfig> | null = null;
let settingLoadEpoch = 0;

interface InflightSettingLoad {
  promise: Promise<void>;
  activePredicates: Set<() => boolean>;
  epoch: number;
}

const inflightSettingLoads = new Map<string, InflightSettingLoad>();

function isActive(predicate: () => boolean): boolean {
  try {
    return predicate();
  } catch {
    return false;
  }
}

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

export function setSharedSpaceSetting(
  setting: SpaceSetting | null,
  apiAvailable: boolean,
  spaceId?: string
) {
  sharedState = {
    spaceSetting: setting,
    loaded: true,
    apiAvailable,
    loadedSpaceId: spaceId ?? sharedState.loadedSpaceId,
  };
  notify();
}

export function resetSharedSpaceSetting() {
  sharedState = {
    spaceSetting: null,
    loaded: false,
    apiAvailable: false,
    loadedSpaceId: null,
  };
  configPromise = null;
  settingLoadEpoch += 1;
  inflightSettingLoads.clear();
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function fetchAndApplySpaceSetting(
  spaceId: string,
  feedbackUrl: string | undefined,
  isSpaceActive: () => boolean
): Promise<void> {
  try {
    const setting = await getSpaceSetting(spaceId);
    if (!isSpaceActive()) return;
    setSharedSpaceSetting(setting, true, spaceId);

    if (
      feedbackUrl &&
      setting.voice_input_enabled === 1 &&
      setting.voice_feedback_on === 1
    ) {
      if (VoiceFeedback.shared()) {
        VoiceFeedback.shared()!.enable(feedbackUrl);
      } else {
        VoiceFeedback.init(feedbackUrl);
      }
    } else if (VoiceFeedback.shared()) {
      VoiceFeedback.shared()!.disable();
    }
  } catch (err: unknown) {
    if (!isSpaceActive()) return;
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      setSharedSpaceSetting(defaultSetting, false, spaceId);
    } else {
      setSharedSpaceSetting(
        { ...defaultSetting, voice_feedback_on: 0 },
        false,
        spaceId
      );
    }
  }
}

export function ensureVoiceFeedbackLoaded(
  spaceId: string,
  isSpaceActive: () => boolean
): Promise<void> {
  if (!spaceId) return Promise.resolve();

  if (
    sharedState.loaded &&
    sharedState.apiAvailable &&
    sharedState.loadedSpaceId === spaceId
  )
    return Promise.resolve();

  const existing = inflightSettingLoads.get(spaceId);
  if (
    existing?.epoch === settingLoadEpoch &&
    [...existing.activePredicates].some(isActive)
  ) {
    existing.activePredicates.add(isSpaceActive);
    return existing.promise;
  }

  const epoch = settingLoadEpoch;
  const activePredicates = new Set([isSpaceActive]);
  const isLoadActive = () =>
    settingLoadEpoch === epoch && [...activePredicates].some(isActive);
  let promise!: Promise<void>;
  promise = (async () => {
    try {
      if (!configPromise) {
        configPromise = VoiceService.shared.getConfig();
      }
      const config = await configPromise;
      if (!isLoadActive()) return;

      setSharedVoiceConfig(config);
      await fetchAndApplySpaceSetting(
        spaceId,
        config.feedback_url,
        isLoadActive
      );
    } catch {
      configPromise = null;
    }
  })().finally(() => {
    if (inflightSettingLoads.get(spaceId)?.promise === promise) {
      inflightSettingLoads.delete(spaceId);
    }
  });
  inflightSettingLoads.set(spaceId, { promise, activePredicates, epoch });
  return promise;
}

export async function toggleVoiceFeedback(
  spaceId: string,
  newValue: number,
  feedbackUrl?: string
): Promise<void> {
  await updateSpaceSetting(spaceId, { voice_feedback_on: newValue });

  if (sharedState.spaceSetting && sharedState.loadedSpaceId === spaceId) {
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, voice_feedback_on: newValue },
      sharedState.apiAvailable,
      spaceId
    );
  }

  const feedbackAllowed =
    sharedState.loadedSpaceId === spaceId &&
    sharedState.spaceSetting?.voice_input_enabled === 1;

  if (newValue === 0 || !feedbackAllowed) {
    VoiceFeedback.shared()?.disable();
  } else if (feedbackUrl) {
    if (VoiceFeedback.shared()) {
      VoiceFeedback.shared()!.enable(feedbackUrl);
    } else {
      VoiceFeedback.init(feedbackUrl);
    }
  }
}

export async function enableVoiceInput(spaceId: string): Promise<void> {
  const data: Partial<SpaceSetting> = {
    voice_input_enabled: 1,
  };
  await updateSpaceSetting(spaceId, data);

  if (sharedState.spaceSetting && sharedState.loadedSpaceId === spaceId) {
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, ...data },
      sharedState.apiAvailable,
      spaceId
    );
  }
}

export async function disableVoiceInput(spaceId: string): Promise<void> {
  const data: Partial<SpaceSetting> = {
    voice_input_enabled: 0,
    voice_feedback_on: 0,
  };
  await updateSpaceSetting(spaceId, data);

  if (sharedState.spaceSetting && sharedState.loadedSpaceId === spaceId) {
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, ...data },
      sharedState.apiAvailable,
      spaceId
    );
  }

  VoiceFeedback.shared()?.disable();
}

export async function acceptVoiceInput(
  spaceId: string,
  feedbackOn: boolean,
  isSpaceActive: () => boolean
): Promise<void> {
  const data: Partial<SpaceSetting> = {
    voice_input_enabled: 1,
    voice_feedback_notice_acked: 1,
    voice_feedback_on: feedbackOn ? 1 : 0,
  };
  await updateSpaceSetting(spaceId, data);
  if (!isSpaceActive()) return;

  if (sharedState.spaceSetting && sharedState.loadedSpaceId === spaceId) {
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, ...data },
      sharedState.apiAvailable,
      spaceId
    );
  }

  if (feedbackOn) {
    const feedbackUrl = sharedVoiceConfig?.feedback_url;
    if (feedbackUrl) {
      if (VoiceFeedback.shared()) {
        VoiceFeedback.shared()!.enable(feedbackUrl);
      } else {
        VoiceFeedback.init(feedbackUrl);
      }
    }
  }
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
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const updateSetting = useCallback((partial: Partial<SpaceSetting>) => {
    if (!sharedState.spaceSetting) return;
    setSharedSpaceSetting(
      { ...sharedState.spaceSetting, ...partial },
      sharedState.apiAvailable
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
