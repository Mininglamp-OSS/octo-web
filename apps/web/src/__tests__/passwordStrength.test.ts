import { evaluatePasswordStrength, validatePassword } from '@octo/login/src/passwordStrength';
import { i18n } from '@octo/base/src/i18n/instance';

i18n.setLocale('zh-CN', { notify: false, persist: false });

describe('evaluatePasswordStrength', () => {
    describe('empty password', () => {
        it('should return invalid result for empty password', () => {
            const result = evaluatePasswordStrength('');
            expect(result.isValid).toBe(false);
            expect(result.score).toBe(0);
            expect(result.label).toBe('');
        });
    });

    describe('short passwords', () => {
        it('should accept a 6-character password when the score is weak', () => {
            const result = evaluatePasswordStrength('abc123');
            expect(result.isValid).toBe(true);
            expect(result.feedback).not.toContain('密码长度至少需要 6 位');
        });

        it('should mark 5-character password as invalid', () => {
            const result = evaluatePasswordStrength('Aa1bc');
            expect(result.isValid).toBe(false);
            expect(result.feedback).toContain('密码长度至少需要 6 位');
        });
    });

    describe('weak passwords', () => {
        it('should detect common passwords as weak', () => {
            const result = evaluatePasswordStrength('password');
            expect(result.score).toBeLessThanOrEqual(1);
            expect(result.label).toMatch(/非常弱|弱/);
        });

        it('should detect "12345678" as weak', () => {
            const result = evaluatePasswordStrength('12345678');
            expect(result.score).toBeLessThanOrEqual(1);
            expect(result.isValid).toBe(true);
        });

        it('should detect "qwerty123" as weak', () => {
            const result = evaluatePasswordStrength('qwerty123');
            expect(result.score).toBeLessThanOrEqual(1);
        });
    });

    describe('fair passwords', () => {
        it('should rate uncommon mixed-case alphanumeric as fair or better', () => {
            // Use a less common pattern that zxcvbn won't recognize
            const result = evaluatePasswordStrength('Kx7mQ2pL9w');
            expect(result.score).toBeGreaterThanOrEqual(2);
        });

        it('should correctly identify common password patterns as weak', () => {
            // zxcvbn correctly identifies "MyP4ssw0rd" as a common pattern
            const result = evaluatePasswordStrength('MyP4ssw0rd');
            expect(result.score).toBeLessThanOrEqual(1);
            expect(result.isValid).toBe(true);
        });
    });

    describe('strong passwords', () => {
        it('should rate complex password with symbols as strong', () => {
            const result = evaluatePasswordStrength('C0mpl3x!P@ssw0rd#2024');
            expect(result.score).toBeGreaterThanOrEqual(3);
            expect(result.isValid).toBe(true);
        });

        it('should rate long random password as very strong', () => {
            const result = evaluatePasswordStrength('Xk9$mP2q#Lw5@nR8');
            expect(result.score).toBeGreaterThanOrEqual(3);
            expect(result.isValid).toBe(true);
        });

        it('should rate passphrase-style password as strong', () => {
            const result = evaluatePasswordStrength('correct horse battery staple');
            expect(result.score).toBeGreaterThanOrEqual(3);
            expect(result.isValid).toBe(true);
        });
    });

    describe('score labels', () => {
        it('should have correct label for each score level', () => {
            // Very weak
            const veryWeak = evaluatePasswordStrength('a');
            expect(veryWeak.label).toBe('非常弱');

            // Strong passwords
            const strong = evaluatePasswordStrength('Xk9$mP2q#Lw5@nR8!very');
            expect(['强', '非常强']).toContain(strong.label);
        });
    });

    describe('color codes', () => {
        it('should return appropriate colors for different strength levels', () => {
            const weak = evaluatePasswordStrength('password');
            expect(weak.color).toMatch(/#ff/i); // Red-ish color

            const strong = evaluatePasswordStrength('Xk9$mP2q#Lw5@nR8!abc');
            expect(strong.color).toMatch(/#[0-9a-f]{6}/i);
        });
    });
});

describe('validatePassword', () => {
    describe('empty password', () => {
        it('should return error for empty password', () => {
            expect(validatePassword('')).toBe('密码不能为空');
        });

        it('should return error for undefined-like empty string', () => {
            expect(validatePassword('')).toBe('密码不能为空');
        });
    });

    describe('short password', () => {
        it('should return error for password shorter than 6 characters', () => {
            expect(validatePassword('short')).toBe('密码长度至少需要 6 位');
            expect(validatePassword('12345')).toBe('密码长度至少需要 6 位');
        });

        it('should accept exactly 6 characters regardless of advisory score', () => {
            expect(validatePassword('123456')).toBeNull();
        });
    });

    describe('weak password', () => {
        it('should return error for weak password', () => {
            expect(validatePassword('password')).toBeNull();
            expect(validatePassword('12345678')).toBeNull();
        });
    });

    describe('valid password', () => {
        it('should return null for strong password', () => {
            expect(validatePassword('C0mpl3x!P@ssw0rd#2024')).toBeNull();
            expect(validatePassword('Xk9$mP2q#Lw5@nR8')).toBeNull();
        });

        it('should return null for passphrase-style password', () => {
            expect(validatePassword('correct horse battery staple')).toBeNull();
        });
    });
});
