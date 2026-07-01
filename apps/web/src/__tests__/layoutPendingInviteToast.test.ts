/**
 * dmwork-web#1068 Round 2 — 登录+邀请自动加群路径也要弹 toast。
 *
 * 上一轮 (dmwork-web#1065) 只覆盖了 InviteLanding 已登录直连加入的场景。
 * lml2468 发现当用户未登录时，InviteLanding 会把他们重定向到 /login 并把邀请码
 * 暂存到 localStorage.pendingInviteCode；登录成功后由 Layout.onLogin 调
 * /space/join 自动加入 —— 但这条路径直接 goMain() 了，**没有写 notice**，
 * 主界面无 toast、也没有「切换过去」按钮。
 *
 * 本测试通过 grep 锁定 Layout.tsx 在 pendingInviteCode 分支中：
 * 1. 共用 computeAndSaveJoinSuccess helper（与 InviteLanding 行为一致）
 * 2. 在 /space/join 之前快照 prevCurrentSpaceId
 * 3. 预取 invite 信息以带上 space_name
 * 4. 只有 !crossSpace 时才写 localStorage.currentSpaceId（不自动切换）
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Layout.onLogin — pendingInviteCode path shares joinSuccessNotice', () => {
    let layout: string;

    beforeAll(() => {
        layout = fs.readFileSync(
            path.join(__dirname, '../Layout/index.tsx'), 'utf-8');
    });

    it('imports computeAndSaveJoinSuccess from @octo/base', () => {
        expect(layout).toMatch(/computeAndSaveJoinSuccess/);
        expect(layout).toMatch(/from\s+["']@octo\/base["']/);
    });

    it('snapshots prevCurrentSpaceId before calling /space/join', () => {
        expect(layout).toMatch(/prevCurrentSpaceId\s*=\s*localStorage\.getItem\(\s*["']currentSpaceId["']/);
        const snapIdx = layout.search(/prevCurrentSpaceId\s*=\s*localStorage/);
        const joinIdx = layout.search(/post\(\s*`\/space\/join`/);
        expect(snapIdx).toBeGreaterThan(0);
        expect(joinIdx).toBeGreaterThan(snapIdx);
    });

    it('pre-fetches invite info to populate space_name for the toast', () => {
        // Needed because /space/join alone doesn't return space_name.
        expect(layout).toMatch(/\/space\/invite\/\$\{pendingInvite\}/);
    });

    it('invokes computeAndSaveJoinSuccess after a successful auto-join', () => {
        expect(layout).toMatch(/computeAndSaveJoinSuccess\s*\(/);
    });

    it('does NOT auto-switch currentSpaceId when crossSpace is true', () => {
        // Only set localStorage.currentSpaceId when !notice.crossSpace
        expect(layout).toMatch(/if\s*\(\s*!notice\.crossSpace\s*&&\s*spaceId\s*\)/);
    });

    it('still removes pendingInviteCode on success so we do not loop', () => {
        expect(layout).toMatch(/localStorage\.removeItem\(\s*["']pendingInviteCode["']\s*\)/);
    });

    it('still routes NEED_APPROVAL / PENDING through onJoinApproval (regression guard)', () => {
        expect(layout).toMatch(/status\s*===\s*["']NEED_APPROVAL["']/);
        expect(layout).toMatch(/onJoinApproval\(/);
    });
});
