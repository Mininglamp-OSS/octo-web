import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the client so sub-views mount without network (evaluate stays pending).
vi.mock('../service/MeetingApiClient', () => ({
  MeetingApiClient: {
    evaluate: vi.fn(() => new Promise(() => {})),
    listMeetings: vi.fn(() => new Promise(() => {})),
    getMeeting: vi.fn(() => new Promise(() => {})),
  },
  newIdempotencyKey: () => 'k',
  MeetingHttpError: class {},
}));

import MeetingRoot from './MeetingRoot';
import { __resetWKApp } from '../__mocks__/dmworkBase';

function goto(path: string) {
  window.history.pushState({}, '', path);
}

beforeEach(() => {
  __resetWKApp();
  vi.clearAllMocks();
});

describe('MeetingRoot in-shell router (#1 deep links)', () => {
  it('/meeting renders the home actions', async () => {
    goto('/meeting');
    render(<MeetingRoot />);
    expect(await screen.findByText('快速会议')).toBeInTheDocument(); // meeting.home.quick
  });

  it('/meeting/join with a credential renders the JoinFlow (evaluates on mount)', async () => {
    goto('/meeting/join?meeting_number=123456');
    const { MeetingApiClient } = await import('../service/MeetingApiClient');
    render(<MeetingRoot />);
    await waitFor(() => expect((MeetingApiClient.evaluate as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
  });

  it('/meeting/join without a credential renders the join-entry form', async () => {
    goto('/meeting/join');
    render(<MeetingRoot />);
    // meeting.join.numberLabel = "会议号或链接"
    expect(await screen.findByLabelText('会议号或链接')).toBeInTheDocument();
  });

  it('/meeting/quick renders the quick-setup form', async () => {
    goto('/meeting/quick');
    render(<MeetingRoot />);
    expect(await screen.findByText('立即开始')).toBeInTheDocument(); // meeting.form.createNow
  });
});
