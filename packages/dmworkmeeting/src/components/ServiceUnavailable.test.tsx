import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ServiceUnavailable from './ServiceUnavailable';
import ParticipantList, { canActOn } from './ParticipantList';

describe('ServiceUnavailable (§6.2 fail-closed)', () => {
  it('gateway-missing shows "feature not enabled" and no retry button', () => {
    render(<ServiceUnavailable reason="gateway-missing" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('service-unavailable offers a retry with the retry_after countdown', () => {
    const onRetry = vi.fn();
    render(<ServiceUnavailable reason="service-unavailable" retryAfter={9} onRetry={onRetry} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('9');
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ParticipantList role gating (FD-23)', () => {
  it('canActOn: host acts on anyone; cohost only on member; member on none', () => {
    expect(canActOn('host', 'host')).toBe(true);
    expect(canActOn('host', 'member')).toBe(true);
    expect(canActOn('cohost', 'member')).toBe(true);
    expect(canActOn('cohost', 'host')).toBe(false);
    expect(canActOn('cohost', 'cohost')).toBe(false);
    expect(canActOn('member', 'member')).toBe(false);
  });

  it('cohost cannot mute another cohost (control greyed / disabled)', () => {
    render(
      <ParticipantList
        capabilities={{ viewerRole: 'cohost' }}
        participants={[{ uid: 'c2', role: 'cohost' }, { uid: 'm1', role: 'member' }]}
        onMute={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // First participant (cohost) → disabled; second (member) → enabled.
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });
});
