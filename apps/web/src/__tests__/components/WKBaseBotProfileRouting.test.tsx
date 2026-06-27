import { vi, describe, it, expect, beforeEach } from 'vitest';
import React, { Component } from 'react';
import { act, render } from '@testing-library/react';

// Import SUT after the mock is declared.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { UserInfoRouter } from '../../../../../packages/dmworkbase/src/Components/WKBase/userInfoRouter';
import {
    createUserInfoRouter,
    UserInfoDispatch,
} from '../../../../../packages/dmworkbase/src/Components/WKBase/userInfoRouter';

// ---------------------------------------------------------------------------
// round-4 blocker: external-viewer gate for bot routing.
//
// When UserInfoVM.isExternalToViewer would return true for a bot (cross-space
// external group click), the router MUST demote isBot=false so the caller
// keeps using the UserInfo path — UserInfo.getBottomPanel then renders the
// existing "仅可在群内交流" hint. Without this demotion, a bot in an
// external group would open BotDetailModal (which decides 发送消息 / 添加好友
// from follow state alone) and bypass the UI guard.
//
// Tests below construct UserInfoRouter directly (not via createUserInfoRouter)
// so a stub ExternalViewerGate can be injected without importing WKApp /
// resolveExternalForViewer — that dependency chain belongs to WKBase, not
// this helper. The host component records the last dispatch's isBot flag so
// we can assert "bot demoted → user route" regardless of rendering details.
// ---------------------------------------------------------------------------

import {
    ExternalViewerGate,
    UserInfoRouter as UserInfoRouterClass,
    ChannelManagerLike,
} from '../../../../../packages/dmworkbase/src/Components/WKBase/userInfoRouter';
import { Channel as ChannelCtor } from 'wukongimjssdk';

/**
 * Integration tests for the production routing + stale-guard used by
 * WKBase.showUserInfo (GH Mininglamp-OSS/octo-web#1112, PR#1113).
 *
 * The previous revision of this file only exercised a hand-copied helper — the
 * real dispatcher could regress silently. This revision imports the actual
 * production helper (`UserInfoRouter` at
 * `packages/dmworkbase/src/Components/WKBase/userInfoRouter.ts`) that
 * `WKBase.showUserInfo` delegates to, and drives it inside a small React host
 * component. Assertions are made on the rendered "current modal" element, so
 * any break in the production routing or removal of the stale-guard causes
 * these tests to FAIL.
 *
 * Why a helper instead of mounting the full <WKBase/>:
 *   - WKBase transitively imports @douyinfe/semi-ui / @tiptap / lottie-web via
 *     its sibling components; vitest's dep pre-bundling chokes on some of
 *     those in jsdom, which `vi.mock` cannot intercept (it runs before module
 *     graph resolution). The helper is deliberately free of React / semi-ui /
 *     lottie imports so the test can load it cleanly.
 *   - WKBase.showUserInfo is a one-liner that forwards to this helper, so a
 *     routing or stale-guard regression is not possible to introduce in
 *     WKBase without also regressing the helper (and therefore this test).
 */

// Minimal in-memory channel-info layer driven by the tests.
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

// Mock wukongimjssdk: only the small surface the router needs. This avoids
// pulling in the real SDK and its browser-only peer deps during the test run.
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
            pendingFetches.set(ch.channelID, { promise, resolve: resolveFn, reject: rejectFn });
            return promise;
        },
    };
    const WKSDK = { shared: () => ({ channelManager }) };
    return {
        default: WKSDK,
        WKSDK,
        Channel,
        ChannelTypePerson: 1,
    };
});

/**
 * Host component that wires the production router exactly the way WKBase does:
 * dispatched result is translated into modal state, and the rendered output
 * reflects which modal (bot or user) would be visible in production. Tests
 * assert on data-testid IDs produced here — breaking the router's routing or
 * stale-guard will change these assertions.
 */
interface HostState {
    modal: 'none' | 'bot' | 'user';
    uid?: string;
    fromChannel?: unknown;
    vercode?: string;
}

class RouterHost extends Component<{ onReady: (host: RouterHost) => void }, HostState> {
    state: HostState = { modal: 'none' };
    private readonly router = createUserInfoRouter((result: UserInfoDispatch) => {
        this.setState({
            modal: result.isBot ? 'bot' : 'user',
            uid: result.uid,
            fromChannel: result.fromChannel,
            vercode: result.vercode,
        });
    });

    componentDidMount() {
        this.props.onReady(this);
    }

    componentWillUnmount() {
        this.router.dispose();
    }

    show(uid: string, fromChannel?: unknown, vercode?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.router.showUserInfo(uid, fromChannel as any, vercode);
    }

    hide() {
        this.router.invalidate();
        this.setState({ modal: 'none', uid: undefined, fromChannel: undefined, vercode: undefined });
    }

    render() {
        const { modal, uid, vercode } = this.state;
        if (modal === 'bot') {
            return <div data-testid="bot-detail-stub" data-uid={uid}>BOT_DETAIL</div>;
        }
        if (modal === 'user') {
            return (
                <div data-testid="user-info-stub" data-uid={uid} data-vercode={vercode}>
                    USER_INFO
                </div>
            );
        }
        return <div data-testid="modal-empty" />;
    }
}

function mountHost() {
    let host: RouterHost | undefined;
    const utils = render(
        <RouterHost onReady={(h) => { host = h; }} />,
    );
    if (!host) throw new Error('RouterHost onReady was not invoked');
    return { ...utils, host };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('WKBase.showUserInfo production helper: routing + stale-guard (GH#1112)', () => {
    beforeEach(() => {
        resetChannelState();
    });

    it('routes a cached bot uid to BotDetailModal (not UserInfo)', () => {
        cacheMap.set('bot_uid', { orgData: { robot: 1 } });
        const { host, queryByTestId } = mountHost();

        act(() => { host.show('bot_uid'); });

        const bot = queryByTestId('bot-detail-stub');
        expect(bot).not.toBeNull();
        expect(bot!.getAttribute('data-uid')).toBe('bot_uid');
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    it('routes a cached human uid to UserInfo (not BotDetailModal)', () => {
        cacheMap.set('alice', { orgData: { robot: 0 } });
        const { host, queryByTestId } = mountHost();

        act(() => { host.show('alice', undefined, 'vc1'); });

        const user = queryByTestId('user-info-stub');
        expect(user).not.toBeNull();
        expect(user!.getAttribute('data-uid')).toBe('alice');
        expect(user!.getAttribute('data-vercode')).toBe('vc1');
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    it('routes a cache-miss bot uid to BotDetailModal after fetch resolves', async () => {
        const { host, queryByTestId } = mountHost();

        act(() => { host.show('bot_uid'); });
        expect(queryByTestId('modal-empty')).not.toBeNull();

        await act(async () => {
            pendingFetches.get('bot_uid')!.resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        expect(queryByTestId('bot-detail-stub')).not.toBeNull();
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    it('falls back to UserInfo when cache-miss fetch rejects', async () => {
        const { host, queryByTestId } = mountHost();

        act(() => { host.show('unknown', undefined, 'vc2'); });

        await act(async () => {
            pendingFetches.get('unknown')!.reject(new Error('network'));
            await flushMicrotasks();
        });

        expect(queryByTestId('user-info-stub')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    // The reviewer-requested stale-guard assertion:
    // A (async, not cached) → B (cached) resolves first → A resolves late
    // must NOT overwrite the current modal (B).
    it('stale-guard: late A.resolve after B already opened MUST NOT overwrite B', async () => {
        cacheMap.set('user_B', { orgData: { robot: 0 } });
        const { host, queryByTestId } = mountHost();

        // Fire A (async fetch pending — no modal yet).
        act(() => { host.show('bot_A'); });
        expect(queryByTestId('modal-empty')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')).toBeNull();
        expect(queryByTestId('user-info-stub')).toBeNull();

        // Fire B (cached → sync dispatch → UserInfo stub rendered).
        act(() => { host.show('user_B'); });
        const userBefore = queryByTestId('user-info-stub');
        expect(userBefore).not.toBeNull();
        expect(userBefore!.getAttribute('data-uid')).toBe('user_B');

        // Now A's late fetch resolves as a bot — stale-guard must drop it.
        await act(async () => {
            pendingFetches.get('bot_A')!.resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        const userAfter = queryByTestId('user-info-stub');
        expect(userAfter).not.toBeNull();
        expect(userAfter!.getAttribute('data-uid')).toBe('user_B');
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    it('stale-guard: hideUserInfo before async resolve discards the late result', async () => {
        const { host, queryByTestId } = mountHost();

        act(() => { host.show('bot_late'); });
        act(() => { host.hide(); });

        await act(async () => {
            pendingFetches.get('bot_late')!.resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        expect(queryByTestId('modal-empty')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')).toBeNull();
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    it('stale-guard: async resolve after unmount is ignored (no setState-on-unmounted warning)', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { host, unmount } = mountHost();

        act(() => { host.show('bot_umount'); });
        unmount();

        await act(async () => {
            pendingFetches.get('bot_umount')!.resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        const setStateWarnings = errSpy.mock.calls.filter((args) =>
            typeof args[0] === 'string' && args[0].includes('unmounted'),
        );
        expect(setStateWarnings).toHaveLength(0);
        errSpy.mockRestore();
    });
});

interface GatedHostState {
    modal: 'none' | 'bot' | 'user';
    uid?: string;
    fromChannel?: unknown;
}

class GatedRouterHost extends Component<
    {
        onReady: (host: GatedRouterHost) => void;
        gate: ExternalViewerGate;
    },
    GatedHostState
> {
    state: GatedHostState = { modal: 'none' };
    private readonly channelManager: ChannelManagerLike = {
        getChannelInfo: (ch) => cacheMap.get(ch.channelID) ?? undefined,
        fetchChannelInfo: (ch) => {
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
    private readonly router = new UserInfoRouterClass(
        this.channelManager,
        (result) => {
            this.setState({
                modal: result.isBot ? 'bot' : 'user',
                uid: result.uid,
                fromChannel: result.fromChannel,
            });
        },
        this.props.gate,
    );

    componentDidMount() {
        this.props.onReady(this);
    }

    componentWillUnmount() {
        this.router.dispose();
    }

    show(uid: string, fromChannel?: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.router.showUserInfo(uid, fromChannel as any);
    }

    render() {
        const { modal, uid } = this.state;
        if (modal === 'bot') return <div data-testid="bot-detail-stub" data-uid={uid} />;
        if (modal === 'user') return <div data-testid="user-info-stub" data-uid={uid} />;
        return <div data-testid="modal-empty" />;
    }
}

function mountGatedHost(gate: ExternalViewerGate) {
    let host: GatedRouterHost | undefined;
    const utils = render(
        <GatedRouterHost
            gate={gate}
            onReady={(h) => { host = h; }}
        />,
    );
    if (!host) throw new Error('GatedRouterHost onReady was not invoked');
    return { ...utils, host };
}

describe('UserInfoRouter external-viewer gate: bot in external group demoted to UserInfo', () => {
    beforeEach(() => {
        resetChannelState();
    });

    // Main reviewer scenario: viewer in Space A clicks a bot avatar inside an
    // external group whose members' home_space != A. The gate returns true →
    // router must dispatch isBot=false so the UserInfo path renders the
    // 仅可在群内交流 hint, NOT BotDetailModal.
    it('scenario: external-viewer gate returns true for a bot → routes to UserInfo, NOT BotDetailModal', () => {
        cacheMap.set('external_bot', { orgData: { robot: 1 } });
        const groupChannel = new ChannelCtor('ext_group', 2);
        const gate: ExternalViewerGate = {
            // Simulate UserInfoVM.isExternalToViewer === true for this bot.
            isExternal: (uid, fromChannel) => {
                return uid === 'external_bot' && fromChannel?.channelID === 'ext_group';
            },
        };

        const { host, queryByTestId } = mountGatedHost(gate);

        act(() => { host.show('external_bot', groupChannel); });

        // Must route to UserInfo (where getBottomPanel shows the external hint),
        // NOT to BotDetailModal (which would bypass the external hint).
        expect(queryByTestId('user-info-stub')).not.toBeNull();
        expect(queryByTestId('user-info-stub')!.getAttribute('data-uid')).toBe('external_bot');
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    // Control: same bot, same fromChannel, gate returns false → still a bot.
    // Guards against a future refactor that silently always-demotes bots.
    it('control: gate returns false → bot still routes to BotDetailModal', () => {
        cacheMap.set('internal_bot', { orgData: { robot: 1 } });
        const groupChannel = new ChannelCtor('int_group', 2);
        const gate: ExternalViewerGate = { isExternal: () => false };

        const { host, queryByTestId } = mountGatedHost(gate);

        act(() => { host.show('internal_bot', groupChannel); });

        expect(queryByTestId('bot-detail-stub')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')!.getAttribute('data-uid')).toBe('internal_bot');
        expect(queryByTestId('user-info-stub')).toBeNull();
    });

    // Async cache-miss path must apply the gate too — not only the sync path.
    // Otherwise a bot whose channel info isn't cached would still leak into
    // BotDetailModal after fetch resolves.
    it('async cache-miss: gate applies after fetch resolves → external bot → UserInfo', async () => {
        const groupChannel = new ChannelCtor('ext_group', 2);
        const gate: ExternalViewerGate = {
            isExternal: (uid) => uid === 'async_external_bot',
        };

        const { host, queryByTestId } = mountGatedHost(gate);

        act(() => { host.show('async_external_bot', groupChannel); });
        expect(queryByTestId('modal-empty')).not.toBeNull();

        await act(async () => {
            pendingFetches
                .get('async_external_bot')!
                .resolve({ orgData: { robot: 1 } });
            await flushMicrotasks();
        });

        expect(queryByTestId('user-info-stub')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });

    // Non-bot control: gate isExternal is true, but the user isn't a bot, so
    // routing is UserInfo regardless. Asserts the gate isn't accidentally
    // inverting the human path.
    it('control: non-bot human with external gate true → still UserInfo (no promotion)', () => {
        cacheMap.set('external_human', { orgData: { robot: 0 } });
        const groupChannel = new ChannelCtor('ext_group', 2);
        const gate: ExternalViewerGate = { isExternal: () => true };

        const { host, queryByTestId } = mountGatedHost(gate);

        act(() => { host.show('external_human', groupChannel); });

        expect(queryByTestId('user-info-stub')).not.toBeNull();
        expect(queryByTestId('bot-detail-stub')).toBeNull();
    });
});

