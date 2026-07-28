import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps (lottie/tiptap); stub to shells.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement('button', { onClick, disabled, 'aria-label': rest['aria-label'] }, icon, children);
  const Spin = () => r.createElement('div', { className: 'spin' });
  return { Button, Spin };
});

vi.mock('../../api/driveApi', () => {
  class DriveApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
      super(message);
      this.name = 'DriveApiError';
      this.code = code;
      this.status = status;
    }
  }
  return {
    DriveApiError,
    acceptInvite: vi.fn(),
  };
});

import * as api from '../../api/driveApi';
import { DriveApiError } from '../../api/driveApi';
import InviteLandingPage from '../InviteLandingPage';

beforeEach(() => {
  vi.mocked(api.acceptInvite).mockReset();
});

describe('InviteLandingPage', () => {
  it('shows the joined state with the granted role on success', async () => {
    vi.mocked(api.acceptInvite).mockResolvedValue({
      space_id: 's1',
      role: 'editor',
      already_member: false,
    });
    const { getByText } = render(<InviteLandingPage token="inv-1" />);
    await waitFor(() => getByText('drive.landing.invite.joinedTitle'));
    // role label resolves via the existing invite.roleEditor key
    getByText('drive.landing.invite.role: drive.invite.roleEditor');
    expect(api.acceptInvite).toHaveBeenCalledWith('inv-1');
  });

  it('shows the already-member state for an idempotent replay', async () => {
    vi.mocked(api.acceptInvite).mockResolvedValue({
      space_id: 's1',
      role: 'downloader',
      already_member: true,
    });
    const { getByText } = render(<InviteLandingPage token="inv-2" />);
    await waitFor(() => getByText('drive.landing.invite.alreadyTitle'));
  });

  it('shows an invalid state for an unknown / expired token', async () => {
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new DriveApiError('not found', 'not_found', 404),
    );
    const { getByText } = render(<InviteLandingPage token="inv-3" />);
    await waitFor(() => getByText('drive.landing.invite.invalidTitle'));
  });

  it('shows a generic error state on server failure', async () => {
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new DriveApiError('boom', 'internal', 500),
    );
    const { getByText } = render(<InviteLandingPage token="inv-4" />);
    await waitFor(() => getByText('drive.landing.invite.errorTitle'));
  });
});
