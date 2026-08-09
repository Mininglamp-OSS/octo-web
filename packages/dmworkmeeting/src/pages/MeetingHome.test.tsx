import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../service/MeetingApiClient', () => ({
  MeetingApiClient: { listMeetings: vi.fn() },
  newIdempotencyKey: () => 'k',
  MeetingHttpError: class {},
}));

import MeetingHome from './MeetingHome';
import { MeetingApiClient } from '../service/MeetingApiClient';
import { __resetWKApp } from '../__mocks__/dmworkBase';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetWKApp();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/meeting');
});

describe('MeetingHome (§4 join-by-list, navigation)', () => {
  it('lists upcoming meetings and joining one navigates to the join deep link', async () => {
    asMock(MeetingApiClient.listMeetings).mockImplementation(async (view: string) =>
      view === 'upcoming'
        ? { meetings: [{ meetingId: 'm1', title: 'Standup', status: 'scheduled', version: 1, passwordEnabled: false }] }
        : { meetings: [] },
    );
    render(<MeetingHome />);
    const item = await screen.findByText('Standup');
    fireEvent.click(item);
    await waitFor(() => expect(window.location.pathname).toBe('/meeting/join'));
    expect(window.location.search).toContain('meeting_id=m1');
  });

  it('renders the fail-closed service view when the gateway route is missing (404 without code)', async () => {
    asMock(MeetingApiClient.listMeetings).mockRejectedValue({ response: { status: 404, data: { message: 'nope' } } });
    render(<MeetingHome />);
    // meeting.service.notEnabled → zh "会议功能未启用"
    expect(await screen.findByText('会议功能未启用')).toBeInTheDocument();
  });
});
