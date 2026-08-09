import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../../__tests__/harness';

// Semi barrel drags in jsdom-hostile deps; stub Button/Spin to shells.
vi.mock('@douyinfe/semi-ui', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await vi.importActual('react');
  const Button = ({ icon, children, onClick, ...rest }: any) =>
    r.createElement('button', { onClick, 'aria-label': rest['aria-label'] }, icon, children);
  const Spin = () => r.createElement('div', { className: 'spin' });
  return { Button, Spin };
});

import SpaceSidebar from '../index';
import type { Space } from '../../../bridge/types';

function space(id: string, type: 'personal' | 'shared', name: string): Space {
  return {
    id,
    type,
    name,
    super_admin_uid: 'sa',
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  };
}

const noop = () => {};

describe('SpaceSidebar', () => {
  it('renders the personal space with the fixed "个人空间" label, not its backend name', () => {
    const personal = space('p', 'personal', 'Personal:11056a5cd3a04965a4f124c168d099d1');
    const { getByText, queryByText } = render(
      <SpaceSidebar
        personalSpace={personal}
        sharedSpaces={[]}
        activeSpaceId={null}
        loading={false}
        onSelect={noop}
        onCreateShared={noop}
      />,
    );
    // The item shows the personal label key (t() returns the key in tests)…
    expect(getByText('drive.space.personal')).toBeInTheDocument();
    // …and never leaks the backend "Personal:<uid>" name.
    expect(queryByText('Personal:11056a5cd3a04965a4f124c168d099d1')).toBeNull();
  });

  it('renders a shared space with its user-given name', () => {
    const shared = space('sh', 'shared', 'OCTO_A 共享空间');
    const { getByText } = render(
      <SpaceSidebar
        personalSpace={null}
        sharedSpaces={[shared]}
        activeSpaceId={null}
        loading={false}
        onSelect={noop}
        onCreateShared={noop}
      />,
    );
    expect(getByText('OCTO_A 共享空间')).toBeInTheDocument();
  });
});
