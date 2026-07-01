import * as fs from 'fs';
import * as path from 'path';

describe('InviteLanding security: no hardcoded verification code', () => {
    let sourceCode: string;

    beforeAll(() => {
        const filePath = path.join(__dirname, '../Components/InviteLanding/index.tsx');
        sourceCode = fs.readFileSync(filePath, 'utf-8');
    });

    describe('registration API', () => {
        // NOTE (architecture migration): InviteLanding no longer performs inline
        // registration. Unauthenticated users are now redirected to the login flow
        // (handleGoLogin → pendingInviteCode), and the actual account-creation call
        // (`user/usernameregister`, flag/name params) lives in
        // packages/dmworklogin/src/login_vm.tsx. The previous positive assertions on
        // `usernameregister` / `flag: 1` / `name:` therefore no longer belong here —
        // they have been removed. The SECURITY intent of this file is preserved below:
        // InviteLanding must never carry a hardcoded verification code or the old
        // vulnerable `user/register` + code pattern.
        it('should not contain hardcoded verification code "123456"', () => {
            // Check for the specific hardcoded code pattern
            const hardcodedCodePattern = /code\s*:\s*["']123456["']/;
            expect(sourceCode).not.toMatch(hardcodedCodePattern);
        });

        it('should not use user/register endpoint with code parameter', () => {
            // The old vulnerable pattern was: user/register with code: "123456"
            const vulnerablePattern = /user\/register.*code/s;
            expect(sourceCode).not.toMatch(vulnerablePattern);
        });
    });

    describe('no hardcoded secrets', () => {
        it('should not contain any hardcoded 6-digit codes in JSON.stringify calls', () => {
            // Check for any hardcoded 6-digit code patterns in JSON.stringify
            const jsonWithHardcodedCode = /JSON\.stringify\([^)]*["']\d{6}["'][^)]*\)/;
            expect(sourceCode).not.toMatch(jsonWithHardcodedCode);
        });
    });
});
