import { describe, it, expect } from 'vitest';
import { buildShareLink, buildInviteLink } from '../links';

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
