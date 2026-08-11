import { describe, it, expect } from 'vitest';
import { parseJoinQuery } from './nav';

describe('parseJoinQuery — cold-load / back-forward deep links (#3, §4)', () => {
  it('extracts link_token (source=link)', () => {
    expect(parseJoinQuery('?link_token=abc')).toEqual({ source: 'link', linkToken: 'abc' });
  });
  it('extracts meeting_number (source=number)', () => {
    expect(parseJoinQuery('?meeting_number=90210')).toEqual({ source: 'number', meetingNumber: '90210' });
  });
  it('accepts the short ?number= alias', () => {
    expect(parseJoinQuery('?number=555')).toEqual({ source: 'number', meetingNumber: '555' });
  });
  it('extracts meeting_id (source=list) for join-by-list deep links', () => {
    expect(parseJoinQuery('?meeting_id=abc')).toEqual({ source: 'list', meetingId: 'abc' });
  });
  it('prefers link_token over number when both present', () => {
    expect(parseJoinQuery('?link_token=t&meeting_number=1')).toEqual({ source: 'link', linkToken: 't' });
  });
  it('never carries a password even if present in the query', () => {
    const r = parseJoinQuery('?meeting_number=1&password=123456');
    expect(r).toEqual({ source: 'number', meetingNumber: '1' });
    expect(JSON.stringify(r)).not.toContain('123456');
  });
  it('returns null with no credential', () => {
    expect(parseJoinQuery('')).toBeNull();
    expect(parseJoinQuery('?foo=bar')).toBeNull();
  });
});
