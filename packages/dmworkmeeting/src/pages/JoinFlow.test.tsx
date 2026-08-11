import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the HTTP client so the orchestrator is exercised without network.
vi.mock('../service/MeetingApiClient', () => ({
  MeetingApiClient: {
    evaluate: vi.fn(),
    verifyPassword: vi.fn(),
    finalize: vi.fn(),
  },
  newIdempotencyKey: () => 'test-key',
  MeetingHttpError: class {},
}));

import JoinFlow from './JoinFlow';
import { MeetingApiClient } from '../service/MeetingApiClient';

// The @octo/base mock's t() resolves real zh-CN strings.
const T = {
  join: '立即加入',
  challenge: '输入会议密码',
  locked: '会议已锁定',
  ended: '会议已结束',
  leave: '离开',
};

const httpErr = (status: number, code?: string, extra: Record<string, unknown> = {}) => ({
  response: { status, data: { code, ...extra } },
});
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('JoinFlow orchestration (§7)', () => {
  it('eligible without password → PreJoin → finalize success (reuses explicit idempotency key)', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({ eligible: true, meetingId: 'm1', passwordRequired: false });
    asMock(MeetingApiClient.finalize).mockResolvedValue({ livekitUrl: 'wss://x', livekitToken: 'tok', segmentId: 's', role: 'member' });
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);

    fireEvent.click(await screen.findByText(T.join));
    await waitFor(() => expect(MeetingApiClient.finalize).toHaveBeenCalled());
    expect(asMock(MeetingApiClient.finalize).mock.calls[0][1]).toMatchObject({ idempotencyKey: 'test-key' });
    // finalize success renders the room (leave control present), not a placeholder.
    expect(await screen.findByText(T.leave)).toBeInTheDocument();
  });

  it('eligible with password → challenge shown (never before evaluate says so)', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({
      eligible: true,
      meetingId: 'm1',
      passwordRequired: true,
      passwordChallengeId: 'c1',
    });
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    expect(await screen.findByText(T.challenge)).toBeInTheDocument();
  });

  it('LOCKED at evaluate → blocked (recoverable), not a hang and not "ended"', async () => {
    asMock(MeetingApiClient.evaluate).mockRejectedValue(httpErr(423, 'MEETING_LOCKED'));
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    expect(await screen.findByText(T.locked)).toBeInTheDocument();
    expect(screen.queryByText(T.ended)).toBeNull();
    // rendered as the blocked view, keyed by code
    expect(document.querySelector('[data-code="MEETING_LOCKED"]')).not.toBeNull();
  });

  it('LIVEKIT_UNAVAILABLE at finalize keeps PreJoin, does not go to challenge', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({ eligible: true, meetingId: 'm1', passwordRequired: false });
    asMock(MeetingApiClient.finalize).mockRejectedValue(httpErr(503, 'MEETING_LIVEKIT_UNAVAILABLE', { retry_after: 5 }));
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    fireEvent.click(await screen.findByText(T.join));
    await waitFor(() => expect(MeetingApiClient.finalize).toHaveBeenCalled());
    expect(await screen.findByText(T.join)).toBeInTheDocument(); // still PreJoin
    expect(screen.queryByText(T.challenge)).toBeNull();
  });

  it('PASSWORD_COOLDOWN without a parsable retry_at stays on the challenge (no permanent wedge)', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({
      eligible: true,
      meetingId: 'm1',
      passwordRequired: true,
      passwordChallengeId: 'c1',
    });
    asMock(MeetingApiClient.verifyPassword).mockRejectedValue(httpErr(429, 'MEETING_PASSWORD_COOLDOWN'));
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    const input = (await screen.findByLabelText(/6/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    // Input must NOT be permanently disabled — the challenge stays usable.
    await waitFor(() => expect((screen.getByLabelText(/6/i) as HTMLInputElement).disabled).toBe(false));
  });

  it('finalize returning MEETING_PASSWORD_REQUIRED (SHOW_PASSWORD_CHALLENGE) returns to the challenge, not Blocked', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({ eligible: true, meetingId: 'm1', passwordRequired: false });
    asMock(MeetingApiClient.finalize).mockRejectedValue(
      httpErr(428, 'MEETING_PASSWORD_REQUIRED', { password_challenge_id: 'c2' }),
    );
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    fireEvent.click(await screen.findByText(T.join));
    // Back on the challenge form (not a Blocked view).
    expect(await screen.findByText(T.challenge)).toBeInTheDocument();
    expect(document.querySelector('[data-code="MEETING_PASSWORD_REQUIRED"]')).toBeNull();
  });

  it('finalize MEETING_PASSWORD_REQUIRED WITHOUT a challenge id fails closed (blocked), not challenge', async () => {
    asMock(MeetingApiClient.evaluate).mockResolvedValue({ eligible: true, meetingId: 'm1', passwordRequired: false });
    asMock(MeetingApiClient.finalize).mockRejectedValue(httpErr(428, 'MEETING_PASSWORD_REQUIRED'));
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    fireEvent.click(await screen.findByText(T.join));
    // Fail-closed: no challenge id → blocked (INTERNAL), never a bare challenge.
    await waitFor(() => expect(document.querySelector('[data-code="MEETING_INTERNAL"]')).not.toBeNull());
    expect(screen.queryByText(T.challenge)).toBeNull();
  });

  it('ENDED at evaluate → terminal', async () => {
    asMock(MeetingApiClient.evaluate).mockRejectedValue(httpErr(410, 'MEETING_ENDED'));
    render(<JoinFlow source="number" meetingNumber="123" autoStart />);
    expect(await screen.findByText(T.ended)).toBeInTheDocument();
  });
});
