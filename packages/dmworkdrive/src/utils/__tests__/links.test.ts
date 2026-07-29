import { describe, it, expect } from 'vitest';
import {
  buildShareLink,
  buildInviteLink,
  shareTokenFromPath,
  inviteTokenFromPath,
} from '../links';

/** Run `fn` with window.location.pathname overridden, then restore. */
function withPathname(pathname: string, fn: () => void): void {
  const orig = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    value: { origin: 'https://octo.example.com', pathname },
    writable: true,
    configurable: true,
  });
  try {
    fn();
  } finally {
    if (orig) Object.defineProperty(window, 'location', orig);
  }
}

describe('drive links', () => {
  it('buildShareLink uses origin + /drive/s/<id>', () => {
    expect(buildShareLink('sh_abc')).toBe(`${window.location.origin}/drive/s/sh_abc`);
  });

  it('buildInviteLink uses origin + /drive/invite/<token>', () => {
    expect(buildInviteLink('tok_1')).toBe(`${window.location.origin}/drive/invite/tok_1`);
  });

  it('encodes tokens with unsafe path chars', () => {
    expect(buildShareLink('a/b?c')).toBe(`${window.location.origin}/drive/s/a%2Fb%3Fc`);
  });
});

describe('token readers (N5 — malformed URL must not throw)', () => {
  it('reads a well-formed share / invite token from the path', () => {
    withPathname('/drive/s/sh_abc', () => expect(shareTokenFromPath()).toBe('sh_abc'));
    withPathname('/drive/invite/tok_1', () => expect(inviteTokenFromPath()).toBe('tok_1'));
  });

  it('decodes a percent-encoded token', () => {
    withPathname('/drive/s/a%2Fb', () => expect(shareTokenFromPath()).toBe('a/b'));
  });

  it('returns "" (no throw) for a malformed %-escape — would otherwise white-screen the SPA', () => {
    withPathname('/drive/s/%', () => expect(shareTokenFromPath()).toBe(''));
    withPathname('/drive/s/%zz', () => expect(shareTokenFromPath()).toBe(''));
    withPathname('/drive/invite/%E0%A4%A', () => expect(inviteTokenFromPath()).toBe(''));
  });

  it('returns "" when the path has no token segment', () => {
    withPathname('/drive', () => {
      expect(shareTokenFromPath()).toBe('');
      expect(inviteTokenFromPath()).toBe('');
    });
  });
});
