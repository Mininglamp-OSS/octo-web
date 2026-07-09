import { describe, it, expect, beforeEach } from 'vitest';
import {
    agentChatSessionKey,
    readAgentChatSession,
    writeAgentChatSession,
    clearAgentChatSession,
} from './summaryHelpers';

describe('agent chat session_id localStorage helpers', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('scopes the key by channelId', () => {
        expect(agentChatSessionKey('ch1')).toBe('agent-chat-session:ch1');
        expect(agentChatSessionKey('ch2')).toBe('agent-chat-session:ch2');
    });

    it('falls back to a shared key when channelId is missing', () => {
        expect(agentChatSessionKey()).toBe('agent-chat-session:__workbench__');
        expect(agentChatSessionKey('')).toBe('agent-chat-session:__workbench__');
        expect(agentChatSessionKey(null)).toBe('agent-chat-session:__workbench__');
    });

    it('writes and reads a session_id per channel without bleed', () => {
        writeAgentChatSession('ch1', 'sid-1');
        writeAgentChatSession('ch2', 'sid-2');
        expect(readAgentChatSession('ch1')).toBe('sid-1');
        expect(readAgentChatSession('ch2')).toBe('sid-2');
    });

    it('returns empty string when nothing is stored', () => {
        expect(readAgentChatSession('nope')).toBe('');
    });

    it('does not persist an empty session_id', () => {
        writeAgentChatSession('ch1', '');
        expect(localStorage.getItem('agent-chat-session:ch1')).toBeNull();
    });

    it('clears only the targeted channel', () => {
        writeAgentChatSession('ch1', 'sid-1');
        writeAgentChatSession('ch2', 'sid-2');
        clearAgentChatSession('ch1');
        expect(readAgentChatSession('ch1')).toBe('');
        expect(readAgentChatSession('ch2')).toBe('sid-2');
    });
});
