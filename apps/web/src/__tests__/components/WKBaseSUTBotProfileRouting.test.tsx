import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';

// Import the real WKBase after the mocks are hoisted. This must come after
// every vi.mock() above or the real deps would be evaluated first.
import WKBase, {
    WKBaseContext,
} from '../../../../../packages/dmworkbase/src/Components/WKBase';

/**
 * Round-3 regression tests for PR#1113.
 *
 * Unlike the sibling file `WKBaseBotProfileRouting.test.tsx` (which exercises
 * the extracted `UserInfoRouter` helper in isolation), this file mounts the
 * **real** `WKBase` component as the System Under Test and drives its public
 * `showUserInfo(uid)` contract. The goal, per reviewer lml2468's round-2
 * follow-up, is that any future regression in:
 *
 *   - WKBase delegating to `UserInfoRouter` (e.g. someone accidentally reverts
 *     the bot→BotDetailModal dispatch inside `dispatchUserInfo`),
 *   - the WKBase-level wiring of `showBotDetail` / `showUserInfo` /
 *     `userUID` / `visible` props on the rendered modals,
 *   - the stale-request guard on `fetchChannelInfo` (token check survives the
 *     full WKBase→router path, not just the helper in isolation),
 *
 * causes this test to FAIL — even if `UserInfoRouter` stays green in its own
 * unit test. The heavy child components (`UserInfo`, `BotDetailModal`,
 * `ConversationSelect`) are replaced with tiny `data-testid` stubs that echo
 * the props WKBase passed in; `WKModal` is reduced to a conditional wrapper so
 * the `visible` boolean is observable through the DOM.
 *
 * Covered scenarios (round-3 mandated):
 *   (1) click a regular user avatar → UserInfo stub visible, uid matches
 *   (2) click a bot avatar (cache hit) → BotDetailModal stub visible, uid
 *       matches; UserInfo stub not visible
 *   (3) click a bot avatar (cache miss, async fetchChannelInfo resolves) →
 *       eventually BotDetailModal stub visible
 *   (4) stale-guard regression at the WKBase layer: A (pending) → B
 *       (cached, immediately visible) → A resolves late → B stays visible,
 *       A's late dispatch is dropped. If WKBase stops delegating to the router
 *       or the router's token check is removed, this test fails.
 */

// ---------------------------------------------------------------------------
// Test-controlled in-memory channel cache + deferred fetch registry.
// ---------------------------------------------------------------------------

type ChannelInfo = { orgData?: { robot?: number } } | null | undefined;

interface Deferred {
    promise: Promise<ChannelInfo>;
    resolve: (info: ChannelInfo) => void;
    reject: (err?: unknown) => void;
}

const cacheMap = new Map<string, ChannelInfo>();
const pendingFetches = new Map<string, Deferred>();

function resetChannelState() {
    cacheMap.clear();
    pendingFetches.clear();
}

// ---------------------------------------------------------------------------
// Mocks. All mock paths are absolute from this test file so they match the
// resolved module IDs used inside WKBase/index.tsx.
// ---------------------------------------------------------------------------

// wukongimjssdk: WKBase imports Channel; UserInfoRouter uses WKSDK.shared().
// Keep only the tiny surface the real code touches so the SDK's peer deps
// don't need to load.
vi.mock('wukongimjssdk', () => {
    class Channel {
        constructor(public channelID: string, public channelType: number) {}
    }
    const channelManager = {
        getChannelInfo: (ch: Channel) => cacheMap.get(ch.channelID) ?? undefined,
        fetchChannelInfo: (ch: Channel) => {
            let resolveFn!: (info: ChannelInfo) => void;
            let rejectFn!: (err?: unknown) => void;
            const promise = new Promise<ChannelInfo>((res, rej) => {
                resolveFn = res;
                rejectFn = rej;
            });
            pendingFetches.set(ch.channelID, {
                promise,
                resolve: resolveFn,
                reject: rejectFn,
            });
            return promise;
        },
    };
    const WKSDK = { shared: () => ({ channelManager }) };
    return {
        default: WKSDK,
        WKSDK,
        Channel,
        ChannelTypePerson: 1,
        ChannelTypeGroup: 2,
    };
});

// @douyinfe/semi-ui: WKBase uses Modal directly for the global-modal slot.
// Provide a minimal pass-through so the real semi-ui (→ lottie-web → canvas)
// doesn't need to load.
vi.mock('@douyinfe/semi-ui', () => ({
    Modal: (props: {
        visible?: boolean;
        children?: React.ReactNode;
        [k: string]: unknown;
    }) =>
        props.visible ? (
            <div data-testid="semi-modal-stub">{props.children}</div>
        ) : null,
}));

// @tiptap/react: semi-ui's `aiChatInput` sub-module imports @tiptap/react
// eagerly, and the tiptap dist uses `react/jsx-runtime` specifiers that
// Node's strict ESM resolver rejects under Vitest. Even though WKBase never
// reaches aiChatInput at runtime (we mock Modal and WKModal), Vitest still
// resolves semi-ui's module graph, so we short-circuit @tiptap/react here
// to keep the resolve pass from failing. Pre-existing issue affecting
// voiceInputIndicator.test.tsx too — unrelated to the routing logic.
vi.mock('@tiptap/react', () => ({
    Editor: class {},
    EditorContent: () => null,
    useEditor: () => null,
    isNodeEmpty: () => true,
    ReactNodeViewRenderer: () => null,
    NodeViewWrapper: () => null,
}));

// WKApp: WKBase reads apiClient.config.apiURL for the join-org iframe and
// calls endpoints.showConversation in BotDetailModal.onChat. Both are
// irrelevant to the routing contract under test.
vi.mock('../../../../../packages/dmworkbase/src/App', () => ({
    default: {
        apiClient: { config: { apiURL: '/api/v1/' } },
        endpoints: { showConversation: vi.fn() },
    },
}));

// WKModal: conditionally render children when visible=true, otherwise nothing.
// This lets the stale-guard test observe which modal WKBase is actually
// displaying via the usual testing-library queries.
vi.mock(
    '../../../../../packages/dmworkbase/src/Components/WKModal',
    () => ({
        default: (props: {
            visible?: boolean;
            children?: React.ReactNode;
            className?: string;
        }) =>
            props.visible ? (
                <div
                    data-testid="wk-modal-stub"
                    data-classname={props.className}
                >
                    {props.children}
                </div>
            ) : null,
    }),
);

// UserInfo: echo props as data-attrs so the test can assert on uid / vercode.
vi.mock(
    '../../../../../packages/dmworkbase/src/Components/UserInfo',
    () => ({
        default: (props: { uid: string; vercode?: string }) => (
            <div
                data-testid="user-info-stub"
                data-uid={props.uid}
                data-vercode={props.vercode ?? ''}
            >
                USER_INFO
            </div>
        ),
    }),
);

// BotDetailModal: render a stub only when visible=true so the visible prop
// wiring from WKBase is exercised end-to-end.
vi.mock(
    '../../../../../packages/dmworkbase/src/Components/BotDetailModal',
    () => ({
        default: (props: { uid: string; visible: boolean }) =>
            props.visible ? (
                <div data-testid="bot-detail-stub" data-uid={props.uid}>
                    BOT_DETAIL
                </div>
            ) : null,
    }),
);

// ConversationSelect: unused by these tests, but WKBase imports it eagerly.
vi.mock(
    '../../../../../packages/dmworkbase/src/Components/ConversationSelect',
    () => ({
        default: () => <div data-testid="conv-select-stub" />,
    }),
);

// Small harness that hands the WKBase context to the test so it can drive
// showUserInfo without needing to synthesise click events on stubbed children.
function mountWKBase() {
    let ctx: WKBaseContext | undefined;
    const onReadyRef: { current?: (c: WKBaseContext) => void } = {};
    const ready = new Promise<WKBaseContext>((resolve) => {
        onReadyRef.current = (c) => {
            ctx = c;
            resolve(c);
        };
    });
    const utils = render(
        <WKBase onContext={(c) => onReadyRef.current?.(c)}>
            <div data-testid="wkbase-children" />
        </WKBase>,
    );
    // WKBase.componentDidMount synchronously calls onContext, so ctx is set
    // before render() returns.
    if (!ctx) throw new Error('WKBase onContext was not invoked synchronously');
    return { ...utils, ctx, ready };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('WKBase SUT: real component routes bot vs human entries (GH#1112, PR#1113 round-3)', () => {
    beforeEach(() => {
        resetChannelState();
    });

    // Scenario ① — click normal user avatar
    it('scenario 1: normal user avatar → UserInfo visible with matching uid', () => {
        cacheMap.set('alice', { orgData: { robot: 0 } });
        const { ctx, queryByTestId } = mountWKBase();

        act(() => {
            ctx.showUserInfo('alice', undefined, 'vc_invite');
        });

        const user = queryByTestId('user-info-stub');
        expect(user).not.toBeNull();
        expect(user!.getAttribute('data-uid')).toBe('alice');
        expect(user!.getAttribute('data-vercode')).toBe('vc_invite');
        // BotDetailModal stub must NOT appear for a human uid.
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    // Scenario ② — click bot avatar (cache hit)
    it('scenario 2: bot avatar (cache hit) → BotDetailModal visible with matching uid, UserInfo invisible', () => {
        cacheMap.set('bot_cached', { orgData: { robot: 1 } });
        const { ctx, queryByTestId } = mountWKBase();

        act(() => {
            ctx.showUserInfo('bot_cached');
        });

        const bot = queryByTestId('bot-detail-stub');
        expect(bot).not.toBeNull();
        expect(bot!.getAttribute('data-uid')).toBe('bot_cached');
        // UserInfo stub must NOT appear for a bot uid (its WKModal wrapper is
        // also hidden because showUserInfo state stays false).
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    // Scenario ③ — click bot avatar (cache miss, async fetch resolves)
    it('scenario 3: bot avatar (cache miss, async fetch resolves) → BotDetailModal eventually visible', async () => {
        const { ctx, queryByTestId } = mountWKBase();

        act(() => {
            ctx.showUserInfo('bot_async');
        });
        // Before the fetch resolves, neither modal should be showing.
        expect(queryByTestId('bot-detail-stub')).toBeNull();
        expect(queryByTestId('user-info-stub')).toBeNull();

        await act(async () => {
            pendingFetches
                .get('bot_async')!
                .resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        const bot = queryByTestId('bot-detail-stub');
        expect(bot).not.toBeNull();
        expect(bot!.getAttribute('data-uid')).toBe('bot_async');
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    // Scenario ④ — stale-guard reviewer regression at the WKBase layer.
    // If WKBase ever stops delegating to UserInfoRouter (e.g. someone inlines
    // the dispatch again) or the router's token check is removed, A's late
    // resolve will overwrite B's UserInfo modal with a BotDetailModal, and
    // this assertion fails.
    it('scenario 4 (stale-guard): A pending → B cached shows immediately → A resolves late → MUST NOT overwrite B', async () => {
        cacheMap.set('user_B', { orgData: { robot: 0 } });
        const { ctx, queryByTestId } = mountWKBase();

        // A: async fetch pending. No modal yet.
        act(() => {
            ctx.showUserInfo('bot_A');
        });
        expect(queryByTestId('bot-detail-stub')).toBeNull();
        expect(queryByTestId('user-info-stub')).toBeNull();

        // B: cached → synchronous dispatch → UserInfo visible.
        act(() => {
            ctx.showUserInfo('user_B');
        });
        const userBefore = queryByTestId('user-info-stub');
        expect(userBefore).not.toBeNull();
        expect(userBefore!.getAttribute('data-uid')).toBe('user_B');
        expect(queryByTestId('bot-detail-stub')).toBeNull();

        // A's fetch resolves late as a bot. Stale-guard must drop it.
        await act(async () => {
            pendingFetches
                .get('bot_A')!
                .resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        const userAfter = queryByTestId('user-info-stub');
        expect(userAfter).not.toBeNull();
        expect(userAfter!.getAttribute('data-uid')).toBe('user_B');
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });
});
