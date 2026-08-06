import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';

import FilterChips from '../index';

describe('FilterChips', () => {
  it('renders all four options', () => {
    const { getByRole } = render(<FilterChips value="all" onChange={() => {}} />);
    ['drive.filter.all', 'drive.filter.folder', 'drive.filter.doc', 'drive.filter.blob'].forEach(
      (label) => {
        expect(getByRole('button', { name: label })).not.toBeNull();
      },
    );
  });

  it('marks exactly the active option with --active class + aria-pressed', () => {
    const { container } = render(<FilterChips value="folder" onChange={() => {}} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '.drive-filter-chips__chip',
    );
    const active = Array.from(buttons).filter((b) =>
      b.classList.contains('drive-filter-chips__chip--active'),
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe('drive.filter.folder');
    expect(active[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onChange with the picked key', () => {
    const onChange = vi.fn();
    const { getByRole, click } = render(<FilterChips value="all" onChange={onChange} />);
    click(getByRole('button', { name: 'drive.filter.blob' }));
    expect(onChange).toHaveBeenCalledWith('blob');
  });

  it('clicking the already-active chip still fires onChange', () => {
    const onChange = vi.fn();
    const { getByRole, click } = render(<FilterChips value="all" onChange={onChange} />);
    click(getByRole('button', { name: 'drive.filter.all' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
