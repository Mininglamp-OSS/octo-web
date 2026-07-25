import { describe, it, expect, beforeEach } from 'vitest';
import {
    agentChatReferencedKey,
    readAgentChatReferenced,
    writeAgentChatReferenced,
    clearAgentChatReferenced,
} from './summaryHelpers';

describe('agent chat referencedTask localStorage helpers', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('scopes the key by channelId', () => {
        expect(agentChatReferencedKey('ch1')).toBe('agent-chat-referenced:ch1');
        expect(agentChatReferencedKey('ch2')).toBe('agent-chat-referenced:ch2');
    });

    it('falls back to a shared key when channelId is missing', () => {
        expect(agentChatReferencedKey()).toBe('agent-chat-referenced:__workbench__');
        expect(agentChatReferencedKey('')).toBe('agent-chat-referenced:__workbench__');
        expect(agentChatReferencedKey(null)).toBe('agent-chat-referenced:__workbench__');
    });

    it('writes and reads a referenced task per channel without bleed', () => {
        writeAgentChatReferenced('ch1', { task_id: 111, title: 'Alpha' });
        writeAgentChatReferenced('ch2', { task_id: 222, title: 'Beta' });
        expect(readAgentChatReferenced('ch1')).toEqual({ task_id: 111, title: 'Alpha' });
        expect(readAgentChatReferenced('ch2')).toEqual({ task_id: 222, title: 'Beta' });
    });

    it('returns null when nothing is stored', () => {
        expect(readAgentChatReferenced('nope')).toBeNull();
    });

    it('returns null and does not throw on malformed JSON', () => {
        // Simulate a corrupted / unrelated payload written under our key.
        localStorage.setItem('agent-chat-referenced:ch1', 'not-json{{{');
        expect(readAgentChatReferenced('ch1')).toBeNull();
    });

    it('returns null when payload shape is wrong (missing task_id or title)', () => {
        localStorage.setItem('agent-chat-referenced:ch1', JSON.stringify({ foo: 'bar' }));
        expect(readAgentChatReferenced('ch1')).toBeNull();

        localStorage.setItem('agent-chat-referenced:ch2', JSON.stringify({ task_id: 'not-a-number', title: 'x' }));
        expect(readAgentChatReferenced('ch2')).toBeNull();
    });

    it('writing null clears the entry (convenience shortcut)', () => {
        writeAgentChatReferenced('ch1', { task_id: 111, title: 'Alpha' });
        writeAgentChatReferenced('ch1', null);
        expect(readAgentChatReferenced('ch1')).toBeNull();
    });

    it('clears only the targeted channel', () => {
        writeAgentChatReferenced('ch1', { task_id: 111, title: 'Alpha' });
        writeAgentChatReferenced('ch2', { task_id: 222, title: 'Beta' });
        clearAgentChatReferenced('ch1');
        expect(readAgentChatReferenced('ch1')).toBeNull();
        expect(readAgentChatReferenced('ch2')).toEqual({ task_id: 222, title: 'Beta' });
    });

    it('persists only task_id and title (drops extra fields to keep snapshot minimal)', () => {
        writeAgentChatReferenced('ch1', {
            task_id: 333,
            title: 'Gamma',
            // @ts-expect-error extra fields intentionally passed to verify they don't survive
            summary: 'extra field',
        });
        expect(readAgentChatReferenced('ch1')).toEqual({ task_id: 333, title: 'Gamma' });
    });
});
