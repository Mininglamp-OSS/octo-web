import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps (lottie/tiptap); stub to shells.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement('button', { onClick, disabled, 'aria-label': rest['aria-label'] }, icon, children);
  const Input = ({ value, onChange, placeholder }: any) =>
    r.createElement('input', {
      value: value ?? '',
      placeholder,
      onChange: (e: any) => onChange?.(e.target.value),
    });
  const Spin = () => r.createElement('div', { className: 'spin' });
  const Tag = ({ children }: any) => r.createElement('span', null, children);
  return { Button, Input, Spin, Tag };
});

// Manual mock (importActual would load the real @octo/base → tiptap, a jsdom
// landmine). A local DriveApiError keeps the page's `instanceof` branching
// working: page and test share this class via the mocked module.
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
    accessShareByToken: vi.fn(),
    downloadShareByToken: vi.fn(),
    assertSafeUploadURL: () => {},
  };
});

vi.mock('../../utils/download', () => ({ triggerBrowserDownload: vi.fn() }));

import * as api from '../../api/driveApi';
import { DriveApiError } from '../../api/driveApi';
import { triggerBrowserDownload } from '../../utils/download';
import ShareLandingPage from '../ShareLandingPage';
import type { ShareAccess } from '../../bridge/types';

const grant: ShareAccess = {
  permission: 'download',
  file_id: 42,
  file_name: 'quarterly-report.pdf',
  file_size: 2_483_910,
  content_type: 'application/pdf',
  ref_id: 'space/obj/quarterly-report.pdf',
};

beforeEach(() => {
  vi.mocked(api.accessShareByToken).mockReset();
  vi.mocked(api.downloadShareByToken).mockReset();
  vi.mocked(triggerBrowserDownload).mockReset();
});

describe('ShareLandingPage', () => {
  it('shows file metadata and a download action when access succeeds', async () => {
    vi.mocked(api.accessShareByToken).mockResolvedValue(grant);
    const { getByText, queryByRole } = render(<ShareLandingPage token="tok-1" />);
    await waitFor(() => getByText('quarterly-report.pdf'));
    expect(queryByRole('button', { name: 'drive.landing.share.download' })).not.toBeNull();
    expect(api.accessShareByToken).toHaveBeenCalledWith('tok-1', undefined);
  });

  it('downloads via the public share endpoint (no auth) and triggers a browser download', async () => {
    vi.mocked(api.accessShareByToken).mockResolvedValue(grant);
    vi.mocked(api.downloadShareByToken).mockResolvedValue({
      url: 'https://s/anon-dl',
      filename: 'quarterly-report.pdf',
      content_type: 'application/pdf',
    });
    const { getByRole, click } = render(<ShareLandingPage token="tok-1" />);
    await waitFor(() => getByRole('button', { name: 'drive.landing.share.download' }));
    click(getByRole('button', { name: 'drive.landing.share.download' }));
    await waitFor(() =>
      expect(api.downloadShareByToken).toHaveBeenCalledWith('tok-1', undefined),
    );
    expect(triggerBrowserDownload).toHaveBeenCalledWith('https://s/anon-dl', 'quarterly-report.pdf');
  });

  it('prompts for a password (not-yet-given) when the share is password-gated', async () => {
    vi.mocked(api.accessShareByToken).mockRejectedValue(
      new DriveApiError('password required', 'password_required', 403),
    );
    const { getByText, queryByText } = render(<ShareLandingPage token="tok-2" />);
    await waitFor(() => getByText('drive.landing.share.passwordTitle'));
    // First prompt: no "wrong password" hint yet.
    expect(queryByText('drive.landing.share.passwordWrong')).toBeNull();
  });

  it('shows a wrong-password hint when the submitted password is incorrect', async () => {
    vi.mocked(api.accessShareByToken).mockRejectedValue(
      new DriveApiError('wrong password', 'wrong_password', 403),
    );
    const { getByText } = render(<ShareLandingPage token="tok-2b" />);
    await waitFor(() => getByText('drive.landing.share.passwordTitle'));
    getByText('drive.landing.share.passwordWrong');
  });

  it('shows an invalid state for an unknown token', async () => {
    vi.mocked(api.accessShareByToken).mockRejectedValue(
      new DriveApiError('not found', 'not_found', 404),
    );
    const { getByText } = render(<ShareLandingPage token="tok-3" />);
    await waitFor(() => getByText('drive.landing.share.invalidTitle'));
  });

  it('shows an expired state for an expired share', async () => {
    vi.mocked(api.accessShareByToken).mockRejectedValue(
      new DriveApiError('share expired', 'share_expired', 403),
    );
    const { getByText } = render(<ShareLandingPage token="tok-4" />);
    await waitFor(() => getByText('drive.landing.share.expiredTitle'));
  });

  it('falls back to a generic error view for an unrecognized code', async () => {
    vi.mocked(api.accessShareByToken).mockRejectedValue(
      new DriveApiError('boom', 'internal', 500),
    );
    const { getByText } = render(<ShareLandingPage token="tok-5" />);
    await waitFor(() => getByText('drive.landing.share.errorTitle'));
  });
});
