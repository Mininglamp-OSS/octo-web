/**
 * 锁住「空间管理」入口的接线方式,而不只是 URL 构造的结果。
 *
 * buildSpaceAdminUrl 本身有单测(spaceAdminUrl.test.ts),但那些用例无法区分
 * handler 是在 *点击时* 读 WKApp.shared.currentSpaceId,还是用了 render 作用域里
 * 那个同名局部变量。后者是个真实的过期读问题:applySpaceSelection 会同步写
 * WKApp.shared.currentSpaceId,但它的 getMySpaces() 失败分支只弹 toast、不触发
 * re-render,于是切换空间后若刷新列表失败,render 闭包捕获的就是上一个空间 id。
 *
 * 这里沿用本仓 layoutPendingInviteToast.test.ts 的做法:读源码断言调用形状。
 * 断言的是「点击时从 WKApp.shared 取值」这个语义,而不是某一种写法 —— 先把值
 * 存进局部变量再传给 buildSpaceAdminUrl 同样正确,不应该被判失败。
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Main nav 空间管理入口的接线', () => {
    let source: string;
    let handlerCode: string;

    beforeAll(() => {
        source = fs.readFileSync(
            path.join(__dirname, '../Pages/Main/index.tsx'), 'utf-8');
        // 锚定到下一个 prop(menusList)而不是缩进宽度或某条注释:重新格式化、
        // 调整缩进、改写注释都不该让这个测试失效。
        const match = source.match(/onSpaceManagement=\{([\s\S]*?)\n\s*menusList=/);
        expect(match, 'onSpaceManagement handler not found in Main/index.tsx').not.toBeNull();
        // 去掉注释后再断言,避免被注释里的文字（或被注释掉的旧代码）影响判断。
        handlerCode = match![1]
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
    });

    it('点击时从 WKApp.shared 读当前空间,而不是 render 作用域捕获的值', () => {
        // 关键回归点。回退成 buildSpaceAdminUrl(currentSpaceId)(render 闭包)时,
        // handler 体里就不再出现这个符号,本用例失败。
        expect(handlerCode).toMatch(/WKApp\.shared\.currentSpaceId/);
    });

    it('导航目标由 buildSpaceAdminUrl 生成,没有绕过它硬编码路径', () => {
        expect(handlerCode).toMatch(/window\.location\.href\s*=\s*buildSpaceAdminUrl\(/);
        expect(handlerCode).not.toMatch(/["'`]\/space["'`]/);
        expect(handlerCode).not.toMatch(/["'`]\/admin\/space/);
    });

    it('buildSpaceAdminUrl 是从本地模块导入的', () => {
        expect(source).toMatch(
            /import\s*\{\s*buildSpaceAdminUrl\s*\}\s*from\s*["']\.\/spaceAdminUrl["']/);
    });
});
