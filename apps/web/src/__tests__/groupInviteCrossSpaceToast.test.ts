import * as fs from 'fs';
import * as path from 'path';
import baseZhCN from '../../../../packages/dmworkbase/src/i18n/locales/zh-CN.json';

/**
 * dmwork-web#1100 — 跨 Space 群邀请加入后 toast 引导（kind='group'）。
 *
 * 背景：dmworkim H5 `assets/web/join_group.html` scanjoin 成功且 crossSpace
 * 时写 `sessionStorage.pendingJoinSuccessNotice` ≈ { kind: 'group', spaceId,
 * spaceName, entityName, groupNo, groupName, crossSpace: true }。Web 首页
 * MainPage 挂载时调 consumeJoinSuccessNotice + showJoinSuccessToast 消费它，
 * 按 kind='group' 渲染「已加入「<groupName> 群聊」」+「位于「<spaceName> 空间」」+
 * 「切换过去 →」按钮，按钮 onClick 通过 handleSpaceSelected 切到目标 Space。
 *
 * 本组 grep 断言锁定 dmwork-web 这边的全部契约：
 *   A. JoinSuccessNotice type 扩展 `kind?: 'space' | 'group'` + groupNo/groupName
 *   B. JoinSuccessToast 源码含 `kind === "group"` 分支（显式避开 sameName 退化）
 *   C. MainPage showPostJoinToastIfPending 透传 `kind`，group 场景优先取 groupName
 *   D. H5 源（dmworkim）那一侧由 api_invite_h5_test.go 的后端断言 + H5 inline JS
 *      review 覆盖；跨仓库 FS 路径无法在 dmwork-web CI 中稳定访问，故此处不重复 grep。
 */
describe('JoinSuccessToast + MainPage — dmwork-web#1100 cross-space group-join toast', () => {
    let helper: string;
    let toast: string;
    let mainPage: string;

    beforeAll(() => {
        helper = fs.readFileSync(
            path.join(__dirname, '../../../../packages/dmworkbase/src/Utils/joinSuccessNotice.ts'),
            'utf-8');
        toast = fs.readFileSync(
            path.join(__dirname, '../../../../packages/dmworkbase/src/Components/JoinSuccessToast/index.tsx'),
            'utf-8');
        mainPage = fs.readFileSync(
            path.join(__dirname, '../Pages/Main/index.tsx'), 'utf-8');
    });

    // ---------- A. JoinSuccessNotice type 扩展 ----------

    it('A1. JoinSuccessNotice type declares optional kind: "space" | "group"', () => {
        // Allow the union in either order; TypeScript doesn't care.
        const re = /kind\?\s*:\s*(?:"space"\s*\|\s*"group"|"group"\s*\|\s*"space")/;
        expect(helper).toMatch(re);
    });

    it('A2. JoinSuccessNotice type declares optional groupNo and groupName', () => {
        expect(helper).toMatch(/groupNo\?\s*:\s*string/);
        expect(helper).toMatch(/groupName\?\s*:\s*string/);
    });

    it('A3. consumeJoinSuccessNotice still validates spaceId/spaceName (back-compat payloads)', () => {
        expect(helper).toMatch(/typeof\s+parsed\.spaceId\s*!==\s*["']string["']/);
        expect(helper).toMatch(/typeof\s+parsed\.spaceName\s*!==\s*["']string["']/);
    });

    // ---------- B. JoinSuccessToast kind === 'group' 分支 ----------

    it('B1. JoinSuccessToast accepts kind?: "space" | "group" in its options', () => {
        const re = /kind\?\s*:\s*(?:"space"\s*\|\s*"group"|"group"\s*\|\s*"space")/;
        expect(toast).toMatch(re);
    });

    it('B2. JoinSuccessToast has an explicit kind === "group" branch', () => {
        // isGroup 派生自 kind === "group"，在 toast 文案 / sameName 判定里被显式消费。
        expect(toast).toMatch(/kind\s*===\s*["']group["']/);
    });

    it('B3. kind==="group" prevents sameName degrade from firing', () => {
        // sameName 的计算应该带上 !isGroup 前缀（或等价逻辑），保证 group 场景永远走群聊文案。
        expect(toast).toMatch(/!\s*isGroup[\s\S]{0,80}entityName\s*===\s*spaceName/);
    });

    it('B4. non-cross-space group toast shows "已加入「...」群聊"', () => {
        // Toast copy is i18n-driven now: the non-cross-space group branch wires
        // the base.joinSuccessToast.groupJoined key. Assert the key is referenced
        // and the zh-CN value still carries the「<name>」群聊 product copy.
        expect(toast).toMatch(/kind\s*===\s*["']group["']/);
        expect(toast).toContain('base.joinSuccessToast.groupJoined');
        expect(baseZhCN['joinSuccessToast.groupJoined']).toMatch(/已加入「\{\{name\}\}」群聊/);
    });

    it('B5. cross-space group toast shows "位于「<space> 空间」" + "切换过去 →"', () => {
        // 双行分支文案 i18n 化：locatedInSpace + switch 两个 key 仍是既有产品文案，
        // 回归保护避免无意改动（key 引用 + zh-CN 翻译值双重断言）。
        expect(toast).toContain('base.joinSuccessToast.locatedInSpace');
        expect(toast).toContain('base.joinSuccessToast.switch');
        expect(baseZhCN['joinSuccessToast.locatedInSpace']).toMatch(/位于「\{\{name\}\}\s*空间」/);
        expect(baseZhCN['joinSuccessToast.switch']).toMatch(/切换过去\s*→/);
    });

    // ---------- C. MainPage forwards kind + prefers groupName ----------

    it('C1. MainPage.showPostJoinToastIfPending forwards notice.kind to the toast', () => {
        expect(mainPage).toMatch(/kind\s*:\s*notice\.kind/);
    });

    it('C2. MainPage prefers notice.groupName for entityName when kind==="group"', () => {
        // 任何形式的 `notice.kind === "group" && notice.groupName` 优先级都接受。
        expect(mainPage).toMatch(/notice\.kind\s*===\s*["']group["'][\s\S]{0,80}notice\.groupName/);
    });

    it('C3. MainPage reuses handleSpaceSelected as the onSwitch action', () => {
        // group / space 两种场景都复用 NavRail 点击路径，保证 mittBus + notifyListener 一致。
        expect(mainPage).toMatch(/onSwitch\s*:\s*\(\s*\)\s*=>/);
        expect(mainPage).toMatch(/handleSpaceSelected\(\s*notice\.spaceId\s*\)/);
    });

    // ---------- D. Back-compat with "space" payloads ----------

    it('D1. undefined/space kind still renders the original single-line toast', () => {
        // 确认 fallback 分支仍走 base.joinSuccessToast.joined（单行「已加入「...」」，
        // 非群聊文案），避免 group 分支把 space 分支玩坏。key 引用 + zh-CN 值双重断言。
        expect(toast).toContain('base.joinSuccessToast.joined');
        expect(baseZhCN['joinSuccessToast.joined']).toMatch(/已加入「\{\{name\}\}」(?!\s*群聊)/);
    });
});
