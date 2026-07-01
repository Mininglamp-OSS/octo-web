import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import zhCN from '../i18n/zh-CN.json';

/**
 * Unit tests for dmworkim#1319 — InviteLanding need_space
 * handling on the Web SPA.
 *
 * 后端 4 个入群入口 (authorize / detail / scanjoin / handleJoinGroup) 在调用者
 * `GetUserDefaultSpaceID(uid) == ""` 时统一返回：
 *
 *     {"status": "need_space", "msg": "请先加入一个 Space 后再入群"}
 *
 * Web SPA 的 InviteLanding 组件必须识别该契约并渲染「请先加入一个 Space」
 * 引导 + 「去输入邀请码」CTA，不渲染常规加入按钮；CTA 点击触发
 * `WKApp.endpoints.onNeedJoinSpace()` 以弹出 JoinSpacePage 全屏覆盖。
 * JoinSpacePage 成功加入 Space 后，借助既有 `pendingInviteCode` 机制自动
 * 重试入群 / 入 Space（authorize + scanjoin 流程的 Web 对应形式）。
 */

describe('InviteLanding — dmworkim#1319 need_space handling', () => {
    let sourceCode: string;

    beforeAll(() => {
        const filePath = path.join(__dirname, '../Components/InviteLanding/index.tsx');
        sourceCode = fs.readFileSync(filePath, 'utf-8');
    });

    // ── 契约识别 ────────────────────────────────────────────────────────

    it('detects the backend need_space contract on detail/loadInviteInfo', () => {
        // loadInviteInfo 调用 detail 入口 (space/invite/{code})，需要识别 need_space
        expect(sourceCode).toMatch(/isNeedSpaceResponse/);
        // 断言 body.status === "need_space"
        expect(sourceCode).toMatch(/body\.status\s*===\s*["']need_space["']/);
    });

    it('detects the backend need_space contract on authorize/handleJoin', () => {
        // handleJoin 走 POST /space/join（authorize 语义等价路径），也必须识别
        // 同一契约，避免点了按钮才发现需要加 Space。
        const joinBlock = sourceCode.slice(sourceCode.indexOf('async handleJoin'));
        expect(joinBlock).toMatch(/isNeedSpaceResponse\s*\(/);
    });

    it('does NOT gate need_space on resp.ok — supports both 2xx and non-2xx carriers', () => {
        // 后端可能用 200 或 403 返回 need_space 结构；识别只凭 body.status。
        // 回归守卫：isNeedSpaceResponse 的判定体里不能出现 resp.ok 或 HTTP 状态码条件。
        const match = sourceCode.match(/isNeedSpaceResponse\s*\([^)]*\)\s*:\s*boolean\s*\{[^}]*\}/);
        expect(match).not.toBeNull();
        // 函数体内只读 body.status，不读 HTTP status 码 / resp.ok / 数值比较
        expect(match![0]).not.toMatch(/resp\.ok/);
        expect(match![0]).not.toMatch(/\b(?:status|_status)\s*>=?\s*\d/);
        expect(match![0]).not.toMatch(/\b(?:status|_status)\s*<=?\s*\d/);
        expect(match![0]).not.toMatch(/\b(?:status|_status)\s*===\s*\d/);
        // 实际判定基于 body.status
        expect(match![0]).toMatch(/body\.status\s*===\s*["']need_space["']/);
    });

    // ── UI 分支：need_space 态 ────────────────────────────────────────

    it('renders the need_space state (not joinable / external_blocked / invite_required)', () => {
        // 新增 state 字段
        expect(sourceCode).toMatch(/needSpace:\s*boolean/);
        // 初始化为 false
        expect(sourceCode).toMatch(/needSpace:\s*false/);
        // render 里读取
        expect(sourceCode).toMatch(/const\s*\{[^}]*needSpace[^}]*\}\s*=\s*this\.state/);
        // 有独立的 if (needSpace) { ... } 分支
        expect(sourceCode).toMatch(/if\s*\(\s*needSpace\s*\)\s*\{/);
    });

    it('uses a stable testid for the need_space card', () => {
        // E2E / 其他组件可通过 testid 定位，不依赖文案
        expect(sourceCode).toContain('invite-landing-need-space');
        expect(sourceCode).toContain('invite-landing-need-space-cta');
    });

    it('does NOT render the join button in need_space branch', () => {
        // 把 if (needSpace) 分支的渲染块抠出来单独断言，避免整文件误伤
        const needBlock = extractNeedSpaceRenderBlock(sourceCode);
        expect(needBlock).not.toBeNull();
        // 不出现常规加入按钮文案
        expect(needBlock).not.toMatch(/加入\s*Space/);
        expect(needBlock).not.toMatch(/加入群聊/);
        expect(needBlock).not.toMatch(/登录后加入/);
        // 不出现 handleJoin 绑定
        expect(needBlock).not.toMatch(/handleJoin\(/);
    });

    it('shows the guidance copy and the "去输入邀请码" CTA', () => {
        // Copy is i18n-driven now: the need_space render block wires the
        // app.invite.needSpace.* keys instead of literal Chinese strings.
        // Assert the keys are referenced in the branch, and that the zh-CN
        // values still carry the iOS/Android-aligned intent.
        const needBlock = extractNeedSpaceRenderBlock(sourceCode)!;
        expect(needBlock).toContain('app.invite.needSpace.title');
        expect(needBlock).toContain('app.invite.needSpace.cta');
        expect(zhCN['invite.needSpace.title']).toMatch(/请先加入一个\s*Space/);
        expect(zhCN['invite.needSpace.cta']).toContain('去输入邀请码');
    });

    // ── CTA 行为：触发 onNeedJoinSpace ───────────────────────────────

    it('CTA click triggers WKApp.endpoints.onNeedJoinSpace()', () => {
        // 存在 handleGoJoinSpace 方法
        expect(sourceCode).toMatch(/handleGoJoinSpace\s*\(\s*\)\s*\{/);
        // 方法体里调用 onNeedJoinSpace —— 用 balance-aware 抽取整段方法体
        const handlerBody = extractMethodBody(sourceCode, 'handleGoJoinSpace');
        expect(handlerBody).not.toBeNull();
        expect(handlerBody!).toMatch(/WKApp\.endpoints\.onNeedJoinSpace\s*\(\s*\)/);

        // CTA 按钮 onClick 绑定到 handleGoJoinSpace
        const needBlock = extractNeedSpaceRenderBlock(sourceCode)!;
        expect(needBlock).toMatch(/onClick=\{\(\)\s*=>\s*this\.handleGoJoinSpace\(\)\}/);
    });

    it('CTA click persists inviteCode so JoinSpacePage onSuccess can retry', () => {
        // JoinSpacePage.onSuccess → Layout.onSuccess → callOnLogin →
        // onLogin 的 pendingInviteCode 分支自动入 Space（retry authorize/scanjoin
        // 语义对齐）。为了让重试闭环成立，CTA 点击前必须写入 pendingInviteCode。
        const handlerBody = extractMethodBody(sourceCode, 'handleGoJoinSpace');
        expect(handlerBody).not.toBeNull();
        expect(handlerBody!).toMatch(
            /localStorage\.setItem\(\s*["']pendingInviteCode["']\s*,\s*this\.props\.inviteCode\s*\)/
        );
    });

    it('enterNeedSpace also persists inviteCode (defensive: CTA may not be clicked yet)', () => {
        // 进入 need_space 渲染前就先持久化，避免用户在 CTA 点击前页面被刷新丢失邀请码。
        const enterBody = extractMethodBody(sourceCode, 'enterNeedSpace');
        expect(enterBody).not.toBeNull();
        expect(enterBody!).toMatch(
            /localStorage\.setItem\(\s*["']pendingInviteCode["']\s*,\s*this\.props\.inviteCode\s*\)/
        );
        // 并把 state 推入 needSpace
        expect(enterBody!).toMatch(/needSpace:\s*true/);
    });

    // ── 重试闭环：JoinSpacePage 成功后自动入群 ─────────────────────────

    it('relies on the existing pendingInviteCode auto-retry path in Layout', () => {
        // Layout.onSuccess 的 JoinSpacePage 回调既有实现会 callOnLogin()，
        // onLogin 里的 pendingInviteCode 分支会自动重试 /space/join。该闭环
        // 不需要 InviteLanding 自行订阅 onSuccess —— 只需确保 pendingInviteCode
        // 已写入即可。这里断言 Layout 仍保留该回调（回归守卫）。
        const layoutPath = path.join(__dirname, '../Layout/index.tsx');
        const layoutSrc = fs.readFileSync(layoutPath, 'utf-8');
        expect(layoutSrc).toMatch(/pendingInviteCode/);
        // JoinSpacePage.onSuccess 触发 callOnLogin
        expect(layoutSrc).toMatch(/onSuccess=\{\(\)\s*=>\s*\{[\s\S]*?callOnLogin\(\)/);
        // onLogin 里确实调用 /space/join 做自动重试
        expect(layoutSrc).toMatch(/\/space\/join/);
    });

    // ── 状态契约的回归守卫 ──────────────────────────────────────────────

    it('need_space branch is rendered before error/!info to tolerate non-2xx carriers', () => {
        // 如果后端用 403 + body.status=need_space，resp.ok=false，info 为空，
        // 必须优先走 need_space 分支而不是 error 分支。
        const renderStart = sourceCode.indexOf('render()');
        const needIdx = sourceCode.indexOf('if (needSpace)', renderStart);
        const errorIdx = sourceCode.indexOf('if (error || !info)', renderStart);
        expect(needIdx).toBeGreaterThan(-1);
        expect(errorIdx).toBeGreaterThan(-1);
        expect(needIdx).toBeLessThan(errorIdx);
    });

    it('does not regress login CTA or #1006 basePath helpers', () => {
        // 回归：确保 need_space 改动没破坏既有 CTA / basePath 逻辑
        expect(sourceCode).toContain('invite-landing-login-cta');
        expect(sourceCode).toContain('登录后加入');
        expect(sourceCode).toMatch(/getAppBasePath/);
    });
});

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the JSX returned from the `if (needSpace)` branch of render().
 * Matches the pattern `if (needSpace) { return ( ... ); }` — balance-aware
 * against the `(` / `)` of the return expression.
 */
function extractNeedSpaceRenderBlock(src: string): string | null {
    const anchor = src.indexOf('if (needSpace)');
    if (anchor < 0) return null;
    const returnIdx = src.indexOf('return (', anchor);
    if (returnIdx < 0) return null;
    // Start after `return (`
    let i = returnIdx + 'return ('.length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
    }
    if (depth !== 0) return null;
    return src.slice(returnIdx, i);
}

/**
 * Extract the full body of a class method `methodName() { ... }` using
 * brace-balance counting. Needed because method bodies often contain nested
 * `{}` blocks (try/catch, object literals) that defeat non-greedy regex.
 */
function extractMethodBody(src: string, methodName: string): string | null {
    // Find the method signature; allow whitespace / async prefix.
    const sigRegex = new RegExp(
        '(?:\\basync\\s+)?' + methodName + '\\s*\\([^)]*\\)\\s*\\{'
    );
    const match = sigRegex.exec(src);
    if (!match) return null;
    const bodyStart = match.index + match[0].length - 1; // position of `{`
    let depth = 0;
    for (let i = bodyStart; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return src.slice(bodyStart, i + 1);
            }
        }
    }
    return null;
}
