/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGetSpaceSetting = vi.fn();
const mockUpdateSpaceSetting = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../Service/SpaceSettingService', () => ({
  getSpaceSetting: (...args: any[]) => mockGetSpaceSetting(...args),
  updateSpaceSetting: (...args: any[]) => mockUpdateSpaceSetting(...args),
}));

const mockVoiceFeedbackShared = vi.fn();
const mockVoiceFeedbackInit = vi.fn();

vi.mock('../../../Service/VoiceFeedback', () => ({
  default: {
    shared: () => mockVoiceFeedbackShared(),
    init: (...args: any[]) => mockVoiceFeedbackInit(...args),
  },
}));

vi.mock('../../../Service/VoiceService', () => ({
  default: {
    shared: { getConfig: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../../../App', () => ({
  default: {
    shared: { currentSpaceId: 'space-1' },
    mittBus: { on: vi.fn(), off: vi.fn() },
  },
}));

import {
  acceptVoiceInput,
  enableVoiceInput,
  disableVoiceInput,
  setSharedSpaceSetting,
  setSharedVoiceConfig,
  getSharedSpaceFeedbackState,
} from '../useSpaceFeedbackSetting';

describe('useSpaceFeedbackSetting helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSharedSpaceSetting(
      { voice_input_enabled: 0, voice_feedback_on: 0, voice_feedback_notice_acked: 0 },
      true,
      'space-1',
    );
    setSharedVoiceConfig({
      feedback_url: 'https://fb.test',
      feedback_privacy_url: '',
      feedback_user_agreement_url: '',
    } as any);
  });

  describe('acceptVoiceInput', () => {
    it('sets voice_feedback_notice_acked: 1 alongside voice_input_enabled: 1', async () => {
      await acceptVoiceInput('space-1', false);
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith('space-1', {
        voice_input_enabled: 1,
        voice_feedback_notice_acked: 1,
        voice_feedback_on: 0,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(1);
      expect(state.spaceSetting?.voice_input_enabled).toBe(1);
    });

    it('sets voice_feedback_on: 1 when feedbackOn is true', async () => {
      mockVoiceFeedbackShared.mockReturnValue({ enable: vi.fn() });
      await acceptVoiceInput('space-1', true);
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith('space-1', {
        voice_input_enabled: 1,
        voice_feedback_notice_acked: 1,
        voice_feedback_on: 1,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_on).toBe(1);
    });

    it('initializes VoiceFeedback when feedbackOn is true and no shared instance', async () => {
      mockVoiceFeedbackShared.mockReturnValue(null);
      await acceptVoiceInput('space-1', true);
      expect(mockVoiceFeedbackInit).toHaveBeenCalledWith('https://fb.test');
    });
  });

  describe('enableVoiceInput', () => {
    it('sets only voice_input_enabled: 1', async () => {
      await enableVoiceInput('space-1');
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith('space-1', {
        voice_input_enabled: 1,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_input_enabled).toBe(1);
    });

    it('does not touch voice_feedback_notice_acked or voice_feedback_on', async () => {
      await enableVoiceInput('space-1');
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(0);
      expect(state.spaceSetting?.voice_feedback_on).toBe(0);
    });
  });

  describe('disableVoiceInput', () => {
    beforeEach(() => {
      setSharedSpaceSetting(
        { voice_input_enabled: 1, voice_feedback_on: 1, voice_feedback_notice_acked: 1 },
        true,
        'space-1',
      );
    });

    it('sets voice_input_enabled: 0 and voice_feedback_on: 0', async () => {
      mockVoiceFeedbackShared.mockReturnValue({ disable: vi.fn() });
      await disableVoiceInput('space-1');
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith('space-1', {
        voice_input_enabled: 0,
        voice_feedback_on: 0,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_input_enabled).toBe(0);
      expect(state.spaceSetting?.voice_feedback_on).toBe(0);
    });

    it('does NOT reset voice_feedback_notice_acked', async () => {
      mockVoiceFeedbackShared.mockReturnValue({ disable: vi.fn() });
      await disableVoiceInput('space-1');
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(1);
    });

    it('calls VoiceFeedback.shared()?.disable()', async () => {
      const mockDisable = vi.fn();
      mockVoiceFeedbackShared.mockReturnValue({ disable: mockDisable });
      await disableVoiceInput('space-1');
      expect(mockDisable).toHaveBeenCalled();
    });

    it('handles null VoiceFeedback.shared() gracefully', async () => {
      mockVoiceFeedbackShared.mockReturnValue(null);
      await expect(disableVoiceInput('space-1')).resolves.not.toThrow();
    });
  });
});
