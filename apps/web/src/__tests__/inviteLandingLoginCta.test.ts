import * as fs from 'fs';
import * as path from 'path';
import zhCN from '../i18n/zh-CN.json';

describe('InviteLanding — dmwork-web#1047 login CTA for unauthenticated users', () => {
    let sourceCode: string;

    beforeAll(() => {
        const filePath = path.join(__dirname, '../Components/InviteLanding/index.tsx');
        sourceCode = fs.readFileSync(filePath, 'utf-8');
    });

    it('renders an explicit "登录后加入" CTA for unauthenticated users', () => {
        // CTA copy is i18n-driven now; assert the source wires the key and the
        // zh-CN value carries the "登录后加入" intent (E2E 2a greps the rendered text).
        expect(sourceCode).toContain('app.invite.loginAfterJoin');
        expect(zhCN['invite.loginAfterJoin']).toContain('登录后加入');
    });

    it('guides unauthenticated users with a hint near the CTA', () => {
        // Hint copy that explains login/register is required (i18n key + value).
        expect(sourceCode).toContain('app.invite.loginHint');
        expect(zhCN['invite.loginHint']).toMatch(/登录或注册后.*加入/);
    });

    it('exposes a stable test id on the unauthenticated CTA', () => {
        expect(sourceCode).toContain('invite-landing-login-cta');
    });

    it('does NOT hide the join CTA via display:none for unauthenticated users', () => {
        // Regression guard: previous bug hid the join button via display:none
        // We now use conditional rendering based on isLoggedIn, no display:none tricks
        expect(sourceCode).not.toMatch(/display\s*:\s*['"]none['"]/);
    });

    it('stores pendingInviteCode before redirecting to login so auto-join resumes', () => {
        // Post-login auto-join requires the invite code to be persisted
        expect(sourceCode).toMatch(/localStorage\.setItem\(\s*["']pendingInviteCode["']/);
    });

    it('handles session-expired / 401 / 403 on handleJoin by redirecting to login', () => {
        // Logged-in but token-expired users must not be stuck — they should be
        // redirected to login with pendingInviteCode preserved.
        expect(sourceCode).toMatch(/isUnauthorizedError/);
        expect(sourceCode).toMatch(/401/);
        expect(sourceCode).toMatch(/403/);
    });
});
