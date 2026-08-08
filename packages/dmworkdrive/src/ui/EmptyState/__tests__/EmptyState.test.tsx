import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';
import EmptyState from '../index';

describe('EmptyState', () => {
  it('folder-empty variant shows the upload CTA copy', () => {
    const { getByText } = render(<EmptyState variant="folder-empty" />);
    expect(getByText('drive.empty.folder.title')).toBeInTheDocument();
    expect(getByText('drive.empty.folder.hint')).toBeInTheDocument();
  });

  it('folder-empty-readonly variant shows only the quiet title', () => {
    const { getByText, queryByText } = render(<EmptyState variant="folder-empty-readonly" />);
    expect(getByText('drive.empty.readonly.title')).toBeInTheDocument();
    expect(queryByText('drive.empty.folder.hint')).toBeNull();
  });

  it('filter-empty variant shows the clear-filter CTA', () => {
    const onClearFilter = vi.fn();
    const { getByText, click } = render(
      <EmptyState variant="filter-empty" onClearFilter={onClearFilter} />,
    );
    expect(getByText('drive.empty.filter.title')).toBeInTheDocument();
    click(getByText('drive.empty.filter.clear'));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('filter-empty variant hides the CTA when onClearFilter is not provided', () => {
    const { queryByText } = render(<EmptyState variant="filter-empty" />);
    expect(queryByText('drive.empty.filter.clear')).toBeNull();
  });
});
