/**
 * 锁住「空间管理」入口的接线方式,而不只是 URL 构造的结果。
 *
 * buildSpaceAdminUrl 本身有单测(spaceAdminUrl.test.ts),但那些用例无法区分
 * handler 是在 *点击时* 读 WKApp.shared.currentSpaceId,还是用了 render 作用域里
 * 那个同名局部变量。后者是个真实的过期读问题:applySpaceSelection 会同步写
 * WKApp.shared.currentSpaceId,但它的 getMySpaces() 失败分支只弹 toast、不触发
 * re-render,于是切换空间后若刷新列表失败,render 闭包捕获的就是上一个空间 id。
 *
 * 这里沿用本仓 layoutPendingInviteToast.test.ts 的做法:读源码断言调用形状,
 * 这样将来把它改回 render 闭包会立刻失败,而不是静默回归。
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Main nav 空间管理入口的接线', () => {
    let source: string;
    let handlerBody: string;

    beforeAll(() => {
        source = fs.readFileSync(
            path.join(__dirname, '../Pages/Main/index.tsx'), 'utf-8');
        // 取 onSpaceManagement={...} 到下一个 prop 之前的这段,只针对 handler 断言,
        // 避免匹配到文件里别处对 currentSpaceId 的合法使用(如 NavRail 的高亮 prop)。
        const match = source.match(/onSpaceManagement=\{([\s\S]*?)\n\s{40}\/\//);
        expect(match).not.toBeNull();
        handlerBody = match![1];
    });

    it('handler 内部直接从 WKApp.shared 读当前空间,不依赖 render 作用域的变量', () => {
        expect(handlerBody).toMatch(/buildSpaceAdminUrl\(\s*WKApp\.shared\.currentSpaceId\s*\)/);
    });

    it('handler 没有把 render 作用域的 currentSpaceId 传进 buildSpaceAdminUrl', () => {
        // 关键回归点:buildSpaceAdminUrl(currentSpaceId) 这种裸变量形式必须不出现。
        expect(handlerBody).not.toMatch(/buildSpaceAdminUrl\(\s*currentSpaceId\s*\)/);
    });

    it('导航目标来自 buildSpaceAdminUrl,没有绕过它硬编码路径', () => {
        expect(handlerBody).toMatch(/window\.location\.href\s*=\s*buildSpaceAdminUrl\(/);
        expect(handlerBody).not.toMatch(/["'`]\/space["'`]/);
        expect(handlerBody).not.toMatch(/["'`]\/admin\/space/);
    });

    it('buildSpaceAdminUrl 是从本地模块导入的', () => {
        expect(source).toMatch(
            /import\s*\{\s*buildSpaceAdminUrl\s*\}\s*from\s*["']\.\/spaceAdminUrl["']/);
    });
});
