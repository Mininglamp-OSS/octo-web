import { describe, it, expect } from 'vitest';
import { buildSpaceAdminUrl } from '../Pages/Main/spaceAdminUrl';

describe('buildSpaceAdminUrl', () => {
    it('有当前空间时,带上 ?spaceId=', () => {
        expect(buildSpaceAdminUrl('abc123')).toBe('/admin/space?spaceId=abc123');
    });

    it('空串 / undefined / null 时,回退到不带参数的 /admin/space,由后台走默认逻辑', () => {
        expect(buildSpaceAdminUrl('')).toBe('/admin/space');
        expect(buildSpaceAdminUrl(undefined)).toBe('/admin/space');
        expect(buildSpaceAdminUrl(null)).toBe('/admin/space');
    });

    it('包含需要编码字符的 id 会被 encodeURIComponent 处理,避免破坏 URL', () => {
        expect(buildSpaceAdminUrl('a b&c=d')).toBe('/admin/space?spaceId=a%20b%26c%3Dd');
    });

    it('不会被恶意 id 带出 /admin/space 这个前缀', () => {
        // 开放重定向 / 路径逃逸的形状:编码后都只能落在 query 里。
        // eslint-disable-next-line no-script-url -- 这里是被测的输入数据,不是真的当 URL 用
        for (const evil of ['//evil.com', '../../etc/passwd', 'javascript:alert(1)']) {
            expect(buildSpaceAdminUrl(evil)).toMatch(/^\/admin\/space\?spaceId=/);
            expect(buildSpaceAdminUrl(evil)).not.toContain('//evil.com');
        }
    });
});
