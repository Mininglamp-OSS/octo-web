import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';

// Semi's barrel drags in jsdom-hostile deps (lottie/tiptap); stub Button +
// Progress to shells. Button forwards aria-label so the harness can find it.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, icon, children);
  const Progress = ({ percent }: any) => r.createElement('div', { className: 'progress' }, percent);
  return { Button, Progress };
});

import UploadProgress from '../index';
import type { UploadItem } from '../../../hooks/useUpload';

function item(over: Partial<UploadItem> = {}): UploadItem {
  return { id: 'i1', name: 'f.bin', size: 1024, status: 'uploading', progress: 40, ...over };
}

const CANCEL = 'drive.upload.cancel';
const DISMISS = 'drive.upload.dismiss';
const RETRY = 'drive.upload.retry';

describe('UploadProgress — cancel reachability (A2)', () => {
  for (const status of ['preparing', 'uploading', 'confirming'] as const) {
    it(`shows a cancel button that calls onDismiss while ${status}`, () => {
      const onDismiss = vi.fn();
      const { getByRole, queryByRole, click } = render(
        <UploadProgress items={[item({ status })]} onRetry={vi.fn()} onDismiss={onDismiss} />,
      );
      // No terminal-row "dismiss"/"retry" affordance while in flight.
      expect(queryByRole('button', { name: DISMISS })).toBeNull();
      expect(queryByRole('button', { name: RETRY })).toBeNull();
      click(getByRole('button', { name: CANCEL }));
      expect(onDismiss).toHaveBeenCalledWith('i1');
    });
  }

  it('done row shows dismiss (not cancel) and calls onDismiss', () => {
    const onDismiss = vi.fn();
    const { getByRole, queryByRole, click } = render(
      <UploadProgress items={[item({ status: 'done', progress: 100 })]} onRetry={vi.fn()} onDismiss={onDismiss} />,
    );
    expect(queryByRole('button', { name: CANCEL })).toBeNull();
    click(getByRole('button', { name: DISMISS }));
    expect(onDismiss).toHaveBeenCalledWith('i1');
  });

  it('error row keeps retry + dismiss and no cancel', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const { getByRole, queryByRole, click } = render(
      <UploadProgress
        items={[item({ status: 'error', error: 'boom' })]}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );
    expect(queryByRole('button', { name: CANCEL })).toBeNull();
    click(getByRole('button', { name: RETRY }));
    expect(onRetry).toHaveBeenCalledWith('i1');
    click(getByRole('button', { name: DISMISS }));
    expect(onDismiss).toHaveBeenCalledWith('i1');
  });
});
