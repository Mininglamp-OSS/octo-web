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
  // Mirror the real predicate: a 401 that is NOT a share-business code = session expiry.
  const SHARE_BUSINESS_CODES = new Set(['password_required', 'wrong_password', 'share_expired', 'not_found']);
  const isSessionExpiredError = (err: unknown) =>
    err instanceof DriveApiError &&
    err.status === 401 &&
    !(err.code !== undefined && SHARE_BUSINESS_CODES.has(err.code));
  return {
    DriveApiError,
    isSessionExpiredError,
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
    // role label resolves via the shared roleLabel SSOT (drive.member.role*)
    getByText('drive.landing.invite.role: drive.member.roleEditor');
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

  it('fires onClearReturn when the invite is accepted (host drops stashed return target)', async () => {
    vi.mocked(api.acceptInvite).mockResolvedValue({
      space_id: 's1',
      role: 'editor',
      already_member: false,
    });
    const onClearReturn = vi.fn();
    const { getByText } = render(
      <InviteLandingPage token="inv-ok" onClearReturn={onClearReturn} />,
    );
    await waitFor(() => getByText('drive.landing.invite.joinedTitle'));
    expect(onClearReturn).toHaveBeenCalledTimes(1);
  });

  it('fires onClearReturn on an already-member replay (idempotent join clears too)', async () => {
    vi.mocked(api.acceptInvite).mockResolvedValue({
      space_id: 's1',
      role: 'downloader',
      already_member: true,
    });
    const onClearReturn = vi.fn();
    const { getByText } = render(
      <InviteLandingPage token="inv-already" onClearReturn={onClearReturn} />,
    );
    await waitFor(() => getByText('drive.landing.invite.alreadyTitle'));
    expect(onClearReturn).toHaveBeenCalledTimes(1);
  });

  it('fires onClearReturn on an invalid/denied invite (no cross-identity auto-accept residue)', async () => {
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new DriveApiError('not found', 'not_found', 404),
    );
    const onClearReturn = vi.fn();
    const { getByText } = render(
      <InviteLandingPage token="inv-bad" onClearReturn={onClearReturn} />,
    );
    await waitFor(() => getByText('drive.landing.invite.invalidTitle'));
    expect(onClearReturn).toHaveBeenCalledTimes(1);
  });

  it('fires onClearReturn on a generic 5xx error (session still valid)', async () => {
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new DriveApiError('boom', 'internal', 500),
    );
    const onClearReturn = vi.fn();
    const { getByText } = render(
      <InviteLandingPage token="inv-5xx" onClearReturn={onClearReturn} />,
    );
    await waitFor(() => getByText('drive.landing.invite.errorTitle'));
    expect(onClearReturn).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onClearReturn on a genuine session 401 (logout fired → stash kept for post-login return)', async () => {
    vi.mocked(api.acceptInvite).mockRejectedValue(
      new DriveApiError('unauthorized', 'unauthorized', 401),
    );
    const onClearReturn = vi.fn();
    const { getByText } = render(
      <InviteLandingPage token="inv-401" onClearReturn={onClearReturn} />,
    );
    await waitFor(() => getByText('drive.landing.invite.errorTitle'));
    expect(onClearReturn).not.toHaveBeenCalled();
  });

  it('fires onClearReturn when a non-session error rejects AFTER unmount (no residual stash)', async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(api.acceptInvite).mockReturnValue(
      new Promise((_res, rej) => {
        reject = rej;
      }) as ReturnType<typeof api.acceptInvite>,
    );
    const onClearReturn = vi.fn();
    const { unmount } = render(
      <InviteLandingPage token="inv-unmount" onClearReturn={onClearReturn} />,
    );
    // Unmount while acceptInvite is still pending, then reject with a non-session error.
    unmount();
    reject(new DriveApiError('boom', 'internal', 500));
    await waitFor(() => expect(onClearReturn).toHaveBeenCalledTimes(1));
  });

  it('does NOT fire onClearReturn on a session 401 that rejects AFTER unmount (stash kept)', async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(api.acceptInvite).mockReturnValue(
      new Promise((_res, rej) => {
        reject = rej;
      }) as ReturnType<typeof api.acceptInvite>,
    );
    const onClearReturn = vi.fn();
    const { unmount } = render(
      <InviteLandingPage token="inv-unmount-401" onClearReturn={onClearReturn} />,
    );
    unmount();
    reject(new DriveApiError('unauthorized', 'unauthorized', 401));
    // Give the rejected microtask a tick to settle, then assert it stayed uncalled.
    await waitFor(() => expect(api.acceptInvite).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(onClearReturn).not.toHaveBeenCalled();
  });
});
