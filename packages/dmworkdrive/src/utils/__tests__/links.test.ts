import { describe, it, expect } from 'vitest';
import {
  buildShareLink,
  buildInviteLink,
  shareTokenFromPath,
  inviteTokenFromPath,
  isDriveSharePath,
  isDriveInvitePath,
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

describe('landing-path predicates (Q4 — reuse safeDecode, reject malformed/ambiguous tokens)', () => {
  it('accepts a single decodable token segment (with/without trailing slash)', () => {
    expect(isDriveSharePath('/drive/s/abc123')).toBe(true);
    expect(isDriveSharePath('/drive/s/abc123/')).toBe(true);
    expect(isDriveInvitePath('/drive/invite/tok-9')).toBe(true);
  });

  it('rejects a malformed %-escape instead of letting a token="" request through', () => {
    expect(isDriveSharePath('/drive/s/%')).toBe(false);
    expect(isDriveSharePath('/drive/s/%zz')).toBe(false);
    expect(isDriveInvitePath('/drive/invite/%E0%A4%A')).toBe(false);
  });

  it('rejects an encoded slash (%2F) that would smuggle a second segment', () => {
    expect(isDriveSharePath('/drive/s/a%2Fb')).toBe(false);
    expect(isDriveInvitePath('/drive/invite/a%2Fb')).toBe(false);
  });

  it('rejects non-landing and multi-segment paths', () => {
    expect(isDriveSharePath('/drive')).toBe(false);
    expect(isDriveSharePath('/drive/s/')).toBe(false);
    expect(isDriveSharePath('/drive/s/a/b')).toBe(false);
    expect(isDriveInvitePath('/drive/s/abc')).toBe(false);
  });
});
