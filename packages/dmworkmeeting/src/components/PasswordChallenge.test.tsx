import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordChallenge from './PasswordChallenge';

describe('PasswordChallenge (§8, §11 a11y)', () => {
  it('renders a labelled 6-digit input focused on mount, with an assertive status region', () => {
    render(<PasswordChallenge inCooldown={false} cooldownRemainingSeconds={0} onSubmit={() => {}} />);
    const input = screen.getByLabelText(/6/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    const status = document.getElementById('meeting-password-status');
    expect(status).toHaveAttribute('aria-live', 'assertive');
    expect(status).toHaveAttribute('role', 'alert');
  });

  it('a short (format-invalid) password does NOT call onSubmit (not counted)', () => {
    const onSubmit = vi.fn();
    render(<PasswordChallenge inCooldown={false} cooldownRemainingSeconds={0} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/6/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123' } });
    // Submit is disabled below 6 chars; force submit via the form to hit the guard.
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('a valid 6-digit password calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(<PasswordChallenge inCooldown={false} cooldownRemainingSeconds={0} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/6/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('non-digits are stripped from the input', () => {
    render(<PasswordChallenge inCooldown={false} cooldownRemainingSeconds={0} onSubmit={() => {}} />);
    const input = screen.getByLabelText(/6/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab34' } });
    expect(input.value).toBe('1234');
  });

  it('during cooldown the submit is disabled and the countdown is announced', () => {
    render(<PasswordChallenge inCooldown cooldownRemainingSeconds={42} onSubmit={() => {}} />);
    const status = document.getElementById('meeting-password-status');
    expect(status?.textContent).toContain('42');
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('announces remaining attempts after a wrong password', () => {
    render(
      <PasswordChallenge inCooldown={false} cooldownRemainingSeconds={0} lastInvalid attemptsRemaining={3} onSubmit={() => {}} />,
    );
    expect(document.getElementById('meeting-password-status')?.textContent).toContain('3');
  });
});
