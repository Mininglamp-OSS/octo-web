import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';

vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, disabled, ...rest }: any) =>
    r.createElement(
      'button',
      { onClick, disabled, 'aria-label': rest['aria-label'] },
      icon,
      children,
    );
  return { Button };
});

import BulkActionBar from '../index';

const noop = () => {};

function renderBar(over: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  return render(
    <BulkActionBar
      count={2}
      canEdit
      canDownload
      onDelete={noop}
      onMove={noop}
      onDownload={noop}
      onClear={noop}
      {...over}
    />,
  );
}

describe('BulkActionBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = renderBar({ count: 0 });
    expect(container.textContent).toBe('');
  });

  it('renders count text with the selected number', () => {
    const { getByText } = renderBar({ count: 3 });
    expect(getByText('drive.bulk.selected')).toBeInTheDocument();
  });

  it('fires onDelete from the delete button', () => {
    const onDelete = vi.fn();
    const { getByRole, click } = renderBar({ onDelete });
    click(getByRole('button', { name: 'drive.bulk.delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('fires onMove from the move button', () => {
    const onMove = vi.fn();
    const { getByRole, click } = renderBar({ onMove });
    click(getByRole('button', { name: 'drive.bulk.move' }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('fires onDownload from the download button', () => {
    const onDownload = vi.fn();
    const { getByRole, click } = renderBar({ onDownload });
    click(getByRole('button', { name: 'drive.bulk.download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('fires onClear from the × dismiss button', () => {
    const onClear = vi.fn();
    const { getByRole, click } = renderBar({ onClear });
    click(getByRole('button', { name: 'drive.bulk.clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe('permission gating', () => {
    it('hides delete + move when canEdit is false', () => {
      const { queryByRole } = renderBar({ canEdit: false });
      expect(queryByRole('button', { name: 'drive.bulk.delete' })).toBeNull();
      expect(queryByRole('button', { name: 'drive.bulk.move' })).toBeNull();
    });

    it('hides download when canDownload is false', () => {
      const { queryByRole } = renderBar({ canDownload: false });
      expect(queryByRole('button', { name: 'drive.bulk.download' })).toBeNull();
    });

    it('still shows × even with no permissions', () => {
      const { getByRole } = renderBar({ canEdit: false, canDownload: false });
      expect(getByRole('button', { name: 'drive.bulk.clear' })).not.toBeNull();
    });
  });

  describe('busy state', () => {
    it('disables action buttons while busy but leaves × enabled', () => {
      const { getByRole } = renderBar({ busy: true });
      const del = getByRole('button', { name: 'drive.bulk.delete' }) as HTMLButtonElement;
      const move = getByRole('button', { name: 'drive.bulk.move' }) as HTMLButtonElement;
      const dl = getByRole('button', { name: 'drive.bulk.download' }) as HTMLButtonElement;
      const clear = getByRole('button', { name: 'drive.bulk.clear' }) as HTMLButtonElement;
      expect(del.disabled).toBe(true);
      expect(move.disabled).toBe(true);
      expect(dl.disabled).toBe(true);
      // Clear must always work — users trapped mid-batch need an escape hatch.
      expect(clear.disabled).toBe(false);
    });
  });
});
