import * as fs from 'fs';
import * as path from 'path';

/**
 * envsubst 白名单契约(对应 PR #1320 review 的 P1-1 blocking 回归钉):
 *   nginx.conf.template 里每个 `${VAR}` 占位符都必须出现在 docker-entrypoint.sh
 *   的 `envsubst '...'` 允许列表里。漏一个,该占位符会**原样**留在生成的
 *   default.conf 中 —— 例如 `set $track_api_url "${TRACK_API_URL}";` 永远非空,
 *   `if ($track_api_url = "")` 的 fail-closed 守卫永真,那条路由 503,与运维配置无关。
 *   TRACK_API_URL 正是这样漏掉才导致 /track 整条死掉(P1-1)。
 *
 * 这是纯静态文件断言(不依赖 jsdom/运行时):跑 @octo/web 的 vitest(本地
 * `pnpm --filter @octo/web test`,或直接 `vitest run`)即可拦住此类回归 —— 比 `nginx -t`
 * 生成配置更早、更便宜地把"占位符没被替换"钉死。
 * 注意:当前 `.github/workflows/ci.yml` 只跑 build/lint 与少数窄过滤的测试,并不执行
 * @octo/web 这一 suite,故本用例现阶段只在本地 / 按需运行时守门,尚未在 CI 里 gate 该 PR;
 * 若要让它随 CI 强制,需另行调整 ci.yml(本 PR 不动 CI)。
 */
describe('nginx envsubst allowlist covers every template placeholder (P1-1)', () => {
    let tplVars: string[];
    let allowVars: string[];

    beforeAll(() => {
        const tpl = fs.readFileSync(path.resolve(__dirname, '../../../../nginx.conf.template'), 'utf-8');
        const entry = fs.readFileSync(path.resolve(__dirname, '../../../../docker-entrypoint.sh'), 'utf-8');

        // 模板里的 envsubst 占位符:形如 ${UPPER_CASE}。nginx 运行时变量用 $lowercase(无花括号),
        // 天然不会被这个模式误捕。
        const grab = (s: string) => [...new Set([...s.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]))];
        tplVars = grab(tpl);

        // 只取真正的 envsubst 命令行(行首是 envsubst),避免命中正文里"提到 envsubst"的注释。
        const cmdLine = entry.split('\n').find((l) => /^\s*envsubst\s+'/.test(l));
        expect(cmdLine, 'docker-entrypoint.sh 必须有一条 envsubst 命令行').toBeTruthy();
        allowVars = grab(cmdLine!);
    });

    it('template references at least the known upstream vars (sanity)', () => {
        // 防止正则写崩后"空集 ⊆ 空集"假绿:模板里这些占位符必须真的被采到。
        expect(tplVars).toEqual(expect.arrayContaining(['API_URL', 'TRACK_API_URL']));
    });

    it('every ${VAR} in nginx.conf.template is in the envsubst allowlist', () => {
        const missing = tplVars.filter((v) => !allowVars.includes(v));
        expect(missing).toEqual([]);
    });
});
