import { beforeEach, describe, expect, it } from 'vitest';
import {
    installImReadAttentionGate,
    isImReadAttentionAllowed,
    subscribeImReadAttention,
} from './readAttentionHost';

describe('readAttentionHost', () => {
    beforeEach(() => {
        // Reset module state by testing exported behaviors only.
        // The previous gate from an earlier test may still be installed;
        // the tests below rely on the error from a second install.
    });

    describe('default Ordinary Web mode', () => {
        it('allows read attention when no gate is installed', () => {
            expect(isImReadAttentionAllowed()).toBe(true);
        });

        it('subscribe returns a noop when no gate is installed', () => {
            const unsub = subscribeImReadAttention(() => { });
            expect(typeof unsub).toBe('function');
            unsub(); // must not throw
            unsub(); // idempotent
        });
    });

    describe('install / dispose lifecycle', () => {
        it('installs a gate with the given initial value', () => {
            const gate = installImReadAttentionGate(false);
            expect(isImReadAttentionAllowed()).toBe(false);
            gate.dispose();
        });

        it('installs with true initial value', () => {
            const gate = installImReadAttentionGate(true);
            expect(isImReadAttentionAllowed()).toBe(true);
            gate.dispose();
        });

        it('defaults to false', () => {
            const gate = installImReadAttentionGate();
            expect(isImReadAttentionAllowed()).toBe(false);
            gate.dispose();
        });

        it('rejects a second install', () => {
            const gate = installImReadAttentionGate(false);
            expect(() => installImReadAttentionGate(false)).toThrow(
                'a read-attention gate is already installed',
            );
            gate.dispose();
        });

        it('restores Ordinary Web default after dispose', () => {
            const gate = installImReadAttentionGate(false);
            expect(isImReadAttentionAllowed()).toBe(false);
            gate.dispose();
            expect(isImReadAttentionAllowed()).toBe(true);
        });

        it('idempotent dispose', () => {
            const gate = installImReadAttentionGate(false);
            gate.dispose();
            expect(() => gate.dispose()).not.toThrow();
        });
    });

    describe('setAllowed', () => {
        it('updates isImReadAttentionAllowed', () => {
            const gate = installImReadAttentionGate(false);
            gate.setAllowed(true);
            expect(isImReadAttentionAllowed()).toBe(true);
            gate.setAllowed(false);
            expect(isImReadAttentionAllowed()).toBe(false);
            gate.dispose();
        });

        it('noop for same value', () => {
            const gate = installImReadAttentionGate(false);
            const spy = vi.fn();
            subscribeImReadAttention(spy);
            gate.setAllowed(false); // same
            expect(spy).not.toHaveBeenCalled();
            gate.dispose();
        });

        it('ignores setAllowed after dispose', () => {
            const gate = installImReadAttentionGate(false);
            gate.dispose();
            gate.setAllowed(true);
            expect(isImReadAttentionAllowed()).toBe(true); // back to default
        });

        it('coerces truthy/falsy values', () => {
            const gate = installImReadAttentionGate(false);
            gate.setAllowed(1 as any);
            expect(isImReadAttentionAllowed()).toBe(true);
            gate.setAllowed(0 as any);
            expect(isImReadAttentionAllowed()).toBe(false);
            gate.dispose();
        });
    });

    describe('subscribe / listener notification', () => {
        it('notifies listeners on transition', () => {
            const gate = installImReadAttentionGate(false);
            const spy = vi.fn();
            subscribeImReadAttention(spy);
            gate.setAllowed(true);
            expect(spy).toHaveBeenCalledExactlyOnceWith(true);
            gate.dispose();
        });

        it('notifies only the current gate listeners', () => {
            const gate = installImReadAttentionGate(false);
            const spy = vi.fn();
            const unsub = subscribeImReadAttention(spy);
            gate.setAllowed(true);
            unsub(); // remove
            gate.setAllowed(false);
            // second transition after unsub must not call the removed listener
            expect(spy).toHaveBeenCalledExactlyOnceWith(true);
            gate.dispose();
        });

        it('notifies multiple listeners', () => {
            const gate = installImReadAttentionGate(false);
            const a = vi.fn();
            const b = vi.fn();
            subscribeImReadAttention(a);
            subscribeImReadAttention(b);
            gate.setAllowed(true);
            expect(a).toHaveBeenCalledExactlyOnceWith(true);
            expect(b).toHaveBeenCalledExactlyOnceWith(true);
            gate.dispose();
        });

        it('does not notify orphan listeners after gate is replaced', () => {
            const gate = installImReadAttentionGate(false);
            const spy = vi.fn();
            subscribeImReadAttention(spy);
            gate.dispose();
            // A new gate is installed.
            const gate2 = installImReadAttentionGate(false);
            gate2.setAllowed(true);
            expect(spy).not.toHaveBeenCalled();
            gate2.dispose();
        });

        it('handles reentrant transitions', () => {
            const gate = installImReadAttentionGate(false);
            const seen: boolean[] = [];
            subscribeImReadAttention((allowed) => {
                seen.push(allowed);
                // reenter: setAllowed inside listener
                if (!allowed) {
                    gate.setAllowed(true);
                }
            });
            gate.setAllowed(true); // first transition true → listener calls setAllowed(true) (noop)
            // Now set to false → listener sees false, then reenters with true
            gate.setAllowed(false);
            expect(seen).toEqual([true, false, true]);
            gate.dispose();
        });

        it('does not overwrite a later listener with a superseded transition', () => {
            const gate = installImReadAttentionGate(true);
            const later = vi.fn();
            subscribeImReadAttention((allowed) => {
                if (!allowed) gate.setAllowed(true);
            });
            subscribeImReadAttention(later);
            gate.setAllowed(false);
            expect(later.mock.calls).toEqual([[true]]);
            expect(isImReadAttentionAllowed()).toBe(true);
            gate.dispose();
        });
    });
});
