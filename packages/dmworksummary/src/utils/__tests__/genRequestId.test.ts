import { describe, it, expect } from 'vitest';
import { genRequestId, genSessionId } from '../summaryHelpers';

describe('genRequestId (WEB-03 idempotency key)', () => {
    it('returns a non-empty, unique id per call', () => {
        const a = genRequestId();
        const b = genRequestId();
        expect(typeof a).toBe('string');
        expect(a.length).toBeGreaterThan(0);
        expect(a).not.toBe(b);
    });
    it('does not collide with a session id', () => {
        expect(genRequestId()).not.toBe(genSessionId());
    });
});
