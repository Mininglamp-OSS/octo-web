import * as fs from 'fs';
import * as path from 'path';

/**
 * dmwork-web#1065 — 邀请加入后 toast 提示归属 Space + 一键切换。
 *
 * 这组 grep 断言锁定 InviteLanding、MainPage、helper、toast 组件的关键行为：
 * 1. InviteLanding 在 /space/join 前快照 prevCurrentSpaceId
 * 2. 根据 groupSpaceId !== currentSpaceId 判定 crossSpace
 * 3. 跨 Space 时不写 localStorage.currentSpaceId（不自动切换）
 * 4. 把 notice 写入 sessionStorage，MainPage 挂载时消费
 * 5. 切换按钮调用 handleSpaceSelected 显式切
 */
describe('InviteLanding + MainPage — dmwork-web#1065 cross-space toast', () => {
    let inviteLanding: string;
    let mainPage: string;
    let helper: string;
    let toast: string;

    beforeAll(() => {
        inviteLanding = fs.readFileSync(
            path.join(__dirname, '../Components/InviteLanding/index.tsx'), 'utf-8');
        mainPage = fs.readFileSync(
            path.join(__dirname, '../Pages/Main/index.tsx'), 'utf-8');
        helper = fs.readFileSync(
            path.join(__dirname, '../../../../packages/dmworkbase/src/Utils/joinSuccessNotice.ts'),
            'utf-8');
        toast = fs.readFileSync(
            path.join(__dirname, '../../../../packages/dmworkbase/src/Components/JoinSuccessToast/index.tsx'),
            'utf-8');
    });

    it('InviteLanding snapshots prevCurrentSpaceId before /space/join', () => {
        expect(inviteLanding).toMatch(/prevCurrentSpaceId\s*=\s*localStorage\.getItem\(\s*["']currentSpaceId["']/);
        // The snapshot line must precede the actual join call — prevent regression that reads
        // localStorage AFTER join (which wouldn't reflect the user's "pre-join" space).
        // The join now goes through apiFetchJson(`${apiUrl}/space/join`, ...) (was raw fetch).
        const snapIdx = inviteLanding.search(/prevCurrentSpaceId\s*=\s*localStorage/);
        const joinIdx = inviteLanding.search(/apiFetchJson<[^>]*>\(\s*`[^`]*\/space\/join`/);
        expect(snapIdx).toBeGreaterThan(0);
        expect(joinIdx).toBeGreaterThan(snapIdx);
    });

    it('InviteLanding derives crossSpace via computeAndSaveJoinSuccess helper', () => {
        // dmwork-web#1068 Round 2: the crossSpace calculation now lives
        // in the shared helper so Layout.onLogin can reuse the same logic.
        expect(inviteLanding).toMatch(/computeAndSaveJoinSuccess/);
        expect(inviteLanding).toMatch(/crossSpace/);
    });

    it('InviteLanding saves the notice via computeAndSaveJoinSuccess()', () => {
        expect(inviteLanding).toMatch(/computeAndSaveJoinSuccess\s*\(/);
        expect(inviteLanding).toMatch(/crossSpace/);
    });

    it('InviteLanding does NOT auto-switch currentSpaceId when crossSpace is true', () => {
        // Only set localStorage.currentSpaceId when !crossSpace
        expect(inviteLanding).toMatch(/if\s*\(\s*!crossSpace\s*&&\s*joinedSpaceId\s*\)/);
    });

    it('InviteLanding no longer calls Toast.success directly (toast now lives on main page)', () => {
        // Regression guard: earlier impl called Toast.success('加入成功！') which would
        // disappear on window.location.href redirect.
        expect(inviteLanding).not.toMatch(/Toast\.success\(\s*["']加入成功[！!]?["']\s*\)/);
    });

    it('MainPage consumes the notice on mount and shows the toast', () => {
        expect(mainPage).toMatch(/consumeJoinSuccessNotice/);
        expect(mainPage).toMatch(/showJoinSuccessToast/);
        expect(mainPage).toMatch(/showPostJoinToastIfPending/);
    });

    it('MainPage switch action routes through handleSpaceSelected (emits space-changed)', () => {
        // Must reuse the NavRail-equivalent switch path so listeners fire.
        expect(mainPage).toMatch(/onSwitch\s*:\s*\(\)\s*=>\s*\{[\s\S]{0,200}handleSpaceSelected/);
    });

    it('joinSuccessNotice helper exposes save/consume/clear API with sessionStorage', () => {
        expect(helper).toMatch(/saveJoinSuccessNotice/);
        expect(helper).toMatch(/consumeJoinSuccessNotice/);
        expect(helper).toMatch(/clearJoinSuccessNotice/);
        expect(helper).toMatch(/sessionStorage/);
    });

    it('helper consume removes the key even when payload is malformed', () => {
        expect(helper).toMatch(/removeItem\(KEY\)/);
    });

    it('Toast component renders two lines + switch button when crossSpace', () => {
        expect(toast).toMatch(/已加入/);
        expect(toast).toMatch(/切换过去/);
        expect(toast).toMatch(/位于/);
        expect(toast).toMatch(/join-success-toast-switch/);
    });

    it('Toast closes immediately after onSwitch fires', () => {
        // Toast.close(id) must be called in the switch click handler so the toast
        // disappears as the user switches spaces (hard constraint #4 on the issue).
        expect(toast).toMatch(/Toast\.close\(\s*id\s*\)/);
    });

    it('Toast preserves auto-dismiss (duration > 0) even in cross-space variant', () => {
        // Duration default for cross-space should be a positive finite number
        expect(toast).toMatch(/duration:\s*duration\s*\?\?\s*5/);
    });
});
