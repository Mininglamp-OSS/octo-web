import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';
import Breadcrumb from '../index';

describe('Breadcrumb', () => {
  it('renders ancestors as buttons and the current folder as plain text', () => {
    const onNav = vi.fn();
    const { getByRole, queryByRole, getByText } = render(
      <Breadcrumb
        path={[
          { id: 0, name: 'Root' },
          { id: 5, name: 'Sub' },
        ]}
        onNavigate={onNav}
      />,
    );
    expect(getByRole('button', { name: 'Root' })).toBeInTheDocument();
    // The last crumb is the current location — not clickable.
    expect(queryByRole('button', { name: 'Sub' })).toBeNull();
    expect(getByText('Sub')).toBeInTheDocument();
  });

  it('navigates to the clicked ancestor by index', () => {
    const onNav = vi.fn();
    const { getByRole, click } = render(
      <Breadcrumb
        path={[
          { id: 0, name: 'Root' },
          { id: 5, name: 'Sub' },
          { id: 9, name: 'Deep' },
        ]}
        onNavigate={onNav}
      />,
    );
    click(getByRole('button', { name: 'Root' }));
    expect(onNav).toHaveBeenCalledWith(0);
    click(getByRole('button', { name: 'Sub' }));
    expect(onNav).toHaveBeenCalledWith(1);
  });
});
