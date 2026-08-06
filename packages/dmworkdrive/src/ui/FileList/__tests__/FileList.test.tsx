import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';

// Mock Semi UI: its barrel drags in jsdom-hostile transitive deps (lottie,
// tiptap). FileList's own logic (folder vs non-folder rendering, callbacks) is
// what we test; Semi here is just a container shell.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, icon, children);
  const Dropdown: any = ({ children, render }: any) => r.createElement('div', null, render, children);
  Dropdown.Menu = ({ children }: any) => r.createElement('div', null, children);
  Dropdown.Item = ({ children, onClick }: any) => r.createElement('div', { onClick }, children);
  Dropdown.Divider = () => null;
  const Spin = () => r.createElement('div', { className: 'semi-spin-stub' });
  return { Button, Dropdown, Spin };
});

import FileList from '../index';
import type { DriveEntry, FileType } from '../../../bridge/types';

function entry(id: number, name: string, type: FileType): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 0,
    name,
    is_folder: type === 'folder',
    type,
    size: type === 'blob' ? 2048 : 0,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

const noop = () => {};

function renderList(entries: DriveEntry[], loading = false, over: Partial<React.ComponentProps<typeof FileList>> = {}) {
  return render(
    <FileList
      entries={entries}
      loading={loading}
      onOpenFolder={noop}
      onOpenDoc={noop}
      onRename={noop}
      onMove={noop}
      onCopy={noop}
      onDelete={noop}
      onShare={noop}
      onDownload={noop}
      canDownload
      canEdit
      canShare
      {...over}
    />,
  );
}

describe('FileList', () => {
  it('shows the empty hint when there are no entries', () => {
    const { getByText } = renderList([]);
    expect(getByText('drive.file.empty')).toBeInTheDocument();
  });

  it('hides rows and the empty hint while loading', () => {
    const { queryByText } = renderList([entry(1, 'docs', 'folder')], true);
    expect(queryByText('drive.file.empty')).toBeNull();
    expect(queryByText('docs')).toBeNull();
  });

  it('renders a folder name as a clickable button and fires onOpenFolder', () => {
    const onOpen = vi.fn();
    const folder = entry(1, 'docs', 'folder');
    const { getByRole, click } = renderList([folder], false, { onOpenFolder: onOpen });
    click(getByRole('button', { name: 'docs' }));
    expect(onOpen).toHaveBeenCalledWith(folder);
  });

  it('renders non-folder names as plain text (not clickable)', () => {
    const { queryByRole, getByText } = renderList([entry(2, 'a.pdf', 'blob')]);
    expect(queryByRole('button', { name: 'a.pdf' })).toBeNull();
    expect(getByText('a.pdf')).toBeInTheDocument();
  });

  it('renders a doc name as a clickable button and fires onOpenDoc', () => {
    const onOpenDoc = vi.fn();
    const d = entry(3, 'notes', 'doc');
    const { getByRole, click } = renderList([d], false, { onOpenDoc });
    click(getByRole('button', { name: 'notes' }));
    expect(onOpenDoc).toHaveBeenCalledWith(d);
  });

  it('fires onShare from the row menu', () => {
    const onShare = vi.fn();
    const blob = entry(2, 'a.pdf', 'blob');
    const { getByText, click } = renderList([blob], false, { onShare });
    click(getByText('drive.file.share'));
    expect(onShare).toHaveBeenCalledWith(blob);
  });

  it('renders a download button for blob rows and fires onDownload', () => {
    const onDownload = vi.fn();
    const blob = entry(2, 'a.pdf', 'blob');
    const { getByRole, click } = renderList([blob], false, { onDownload });
    click(getByRole('button', { name: 'drive.file.download' }));
    expect(onDownload).toHaveBeenCalledWith(blob);
  });

  it('does not render a download button for folders or docs', () => {
    const folders = renderList([entry(1, 'docs', 'folder')]);
    expect(folders.queryByRole('button', { name: 'drive.file.download' })).toBeNull();
    const docs = renderList([entry(3, 'notes', 'doc')]);
    expect(docs.queryByRole('button', { name: 'drive.file.download' })).toBeNull();
  });

  describe('permission gating', () => {
    it('hides the download button when canDownload is false', () => {
      const { queryByRole } = renderList([entry(2, 'a.pdf', 'blob')], false, { canDownload: false });
      expect(queryByRole('button', { name: 'drive.file.download' })).toBeNull();
    });

    it('hides rename/move/copy/delete when canEdit is false', () => {
      const { queryByText } = renderList([entry(2, 'a.pdf', 'blob')], false, { canEdit: false });
      expect(queryByText('drive.file.rename')).toBeNull();
      expect(queryByText('drive.file.move')).toBeNull();
      expect(queryByText('drive.file.copy')).toBeNull();
      expect(queryByText('drive.file.delete')).toBeNull();
    });

    it('hides the share item when canShare is false', () => {
      const { queryByText } = renderList([entry(2, 'a.pdf', 'blob')], false, { canShare: false });
      expect(queryByText('drive.file.share')).toBeNull();
    });

    it('downloader (download + share only): shows download + share, no edit actions', () => {
      const { getByRole, getByText, queryByText } = renderList([entry(2, 'a.pdf', 'blob')], false, {
        canDownload: true,
        canShare: true,
        canEdit: false,
      });
      expect(getByRole('button', { name: 'drive.file.download' })).not.toBeNull();
      expect(getByText('drive.file.share')).toBeInTheDocument();
      expect(queryByText('drive.file.rename')).toBeNull();
      expect(queryByText('drive.file.delete')).toBeNull();
    });

    it('preview_only (no actions): hides the download button and the whole actions dropdown', () => {
      const { queryByRole, queryByText } = renderList([entry(2, 'a.pdf', 'blob')], false, {
        canDownload: false,
        canShare: false,
        canEdit: false,
      });
      expect(queryByRole('button', { name: 'drive.file.download' })).toBeNull();
      // Empty dropdown must not render at all → no "more actions" trigger.
      expect(queryByRole('button', { name: 'drive.file.actions' })).toBeNull();
      expect(queryByText('drive.file.share')).toBeNull();
    });
  });

  describe('selection', () => {
    function makeSelection(over: Partial<NonNullable<React.ComponentProps<typeof FileList>['selection']>> = {}) {
      const state = { ids: new Set<number>() };
      const toggle = vi.fn((id: number) => {
        if (state.ids.has(id)) state.ids.delete(id);
        else state.ids.add(id);
      });
      const toggleAll = vi.fn();
      return {
        selection: {
          isSelected: (id: number) => state.ids.has(id),
          toggle,
          isAllSelected: false,
          isIndeterminate: false,
          toggleAll,
          ...over,
        },
        toggle,
        toggleAll,
      };
    }

    it('renders no checkboxes when selection prop is omitted', () => {
      const { container } = renderList([entry(1, 'docs', 'folder')]);
      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    });

    it('renders a header checkbox + one per row when selection is provided', () => {
      const { selection } = makeSelection();
      const { container } = renderList([entry(1, 'a', 'blob'), entry(2, 'b', 'blob')], false, {
        selection,
      });
      // 1 header + 2 rows = 3 checkboxes
      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    });

    it('toggles row selection when a row checkbox is clicked', () => {
      const { selection, toggle } = makeSelection();
      const { container, click } = renderList([entry(1, 'a', 'blob')], false, { selection });
      const [, rowCb] = container.querySelectorAll('input[type="checkbox"]');
      click(rowCb);
      expect(toggle).toHaveBeenCalledWith(1);
    });

    it('reflects isSelected state via the row checkbox `checked` prop', () => {
      const { selection } = makeSelection({ isSelected: (id: number) => id === 1 });
      const { container } = renderList([entry(1, 'a', 'blob'), entry(2, 'b', 'blob')], false, {
        selection,
      });
      const rowCbs = container.querySelectorAll<HTMLInputElement>('.drive-file-row:not(.drive-file-row--head) input[type="checkbox"]');
      expect(rowCbs[0].checked).toBe(true);
      expect(rowCbs[1].checked).toBe(false);
    });

    it('applies the --selected row class when the entry is selected', () => {
      const { selection } = makeSelection({ isSelected: (id: number) => id === 1 });
      const { container } = renderList([entry(1, 'a', 'blob'), entry(2, 'b', 'blob')], false, {
        selection,
      });
      const rows = container.querySelectorAll('.drive-file-row:not(.drive-file-row--head)');
      expect(rows[0].classList.contains('drive-file-row--selected')).toBe(true);
      expect(rows[1].classList.contains('drive-file-row--selected')).toBe(false);
    });

    it('fires toggleAll from the header checkbox', () => {
      const { selection, toggleAll } = makeSelection();
      const { container, click } = renderList([entry(1, 'a', 'blob')], false, { selection });
      const headerCb = container.querySelector('input[type="checkbox"]')!;
      click(headerCb);
      expect(toggleAll).toHaveBeenCalled();
    });

    it('sets header checkbox to indeterminate when isIndeterminate is true', () => {
      const { selection } = makeSelection({ isIndeterminate: true });
      const { container } = renderList([entry(1, 'a', 'blob'), entry(2, 'b', 'blob')], false, {
        selection,
      });
      const headerCb = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(headerCb.indeterminate).toBe(true);
    });

    it('sets header checkbox to checked when isAllSelected is true', () => {
      const { selection } = makeSelection({ isAllSelected: true });
      const { container } = renderList([entry(1, 'a', 'blob')], false, { selection });
      const headerCb = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(headerCb.checked).toBe(true);
      expect(headerCb.indeterminate).toBe(false);
    });
  });
});
