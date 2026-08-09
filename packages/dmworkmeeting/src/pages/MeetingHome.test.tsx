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
import { __resetWKApp, __routeRightPushes } from '../__mocks__/dmworkBase';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetWKApp();
  vi.clearAllMocks();
});

describe('MeetingHome (§4 join-by-list, navigation)', () => {
  it('lists upcoming meetings and joining one pushes onto the host route stack', async () => {
    asMock(MeetingApiClient.listMeetings).mockImplementation(async (view: string) =>
      view === 'upcoming'
        ? { meetings: [{ meetingId: 'm1', title: 'Standup', status: 'scheduled', version: 1, passwordEnabled: false }] }
        : { meetings: [] },
    );
    render(<MeetingHome />);
    const item = await screen.findByText('Standup');
    fireEvent.click(item);
    await waitFor(() => expect(__routeRightPushes.length).toBeGreaterThan(0));
  });

  it('renders the fail-closed service view when the gateway route is missing (404 without code)', async () => {
    asMock(MeetingApiClient.listMeetings).mockRejectedValue({ response: { status: 404, data: { message: 'nope' } } });
    render(<MeetingHome />);
    // meeting.service.notEnabled → zh "会议功能未启用"
    expect(await screen.findByText('会议功能未启用')).toBeInTheDocument();
  });
});
