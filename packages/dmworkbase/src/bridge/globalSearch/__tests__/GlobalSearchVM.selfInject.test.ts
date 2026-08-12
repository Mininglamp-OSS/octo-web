import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// GlobalSearchVM 联系人段"搜自己"注入行为守卫（源码级）。
//
// 背景（2026-08 Bug 1）：全局搜索 · 联系人 tab 搜不到自己 —— 因为后端
// `/v1/search/global` 联系人分支结构上不返回自己：
//   - Space 分支 modules/search/api.go:322-324 显式 `if m.UID == loginUID { continue }`
//   - 非 Space 分支走 friend 表，friend.uid=我 + friend.to_uid=别人，self 不在里面
//
// 但全局搜索的产品语义 = 查找，用户搜自己名字应该能命中"我"，跳到自己资料页。
// 修法在 GlobalSearchVM.requestSearch() 拿到 res 后按 keyword 命中 selfName
// 把 self 拼进 friends 头部。
//
// 完整行为测（keyword 命中 / 未命中 / loadMore 幂等 / XSS 转义）没走单测的原因：
// GlobalSearchVM.ts 传递依赖到 SearchService → Messages/* → react-virtuoso 的
// ESM jsx-runtime，vitest 环境不匹配。所以本 suite 用源码级守卫锁住关键
// 不变式，行为验证放在本地部署 + 手动 UI 复现里做。
const vmPath = path.join(__dirname, "..", "GlobalSearchVM.ts");
const vmSrc = fs.readFileSync(vmPath, "utf8");

describe("GlobalSearchVM contacts self-injection (source guard)", () => {
  it("§A: escapeHtml helper is defined and covers &, <, >, \", '", () => {
    // 与后端 html.EscapeString + Components/GlobalSearch/sanitize.ts 的转义集合
    // 完全对齐。少任何一个（尤其单引号 &#39;）会在 XSS 场景下漏 payload。
    expect(vmSrc).toMatch(/function\s+escapeHtml\s*\(/);
    for (const pair of [
      [/&/, "&amp;"],
      [/</, "&lt;"],
      [/>/, "&gt;"],
      [/"/, "&quot;"],
      [/'/, "&#39;"],
    ] as const) {
      const [pat, repl] = pair;
      const rePat = pat.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reRepl = repl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`replace\\(/${rePat}/g,\\s*["']${reRepl}["']\\)`);
      expect(re.test(vmSrc)).toBe(true);
    }
  });

  it("§B: keyword hit on selfName prepends a self friend entry", () => {
    // requestSearch 里必须有：读 loginInfo.uid + selfDisplayName?.() || .name，
    // 判 keyword 命中，命中就把 { channel_id: selfUid, channel_type: 1, ... }
    // spread 到 friends 头部。
    expect(vmSrc).toMatch(/WKApp\.loginInfo\.selfDisplayName\?\.\(\)/);
    expect(vmSrc).toMatch(/WKApp\.loginInfo\.name/);
    // 拼接方向：self 放在头部（新数组 [{...self}, ...friends]）。
    expect(vmSrc).toMatch(
      /this\.searchResult\.friends\s*=\s*\[\s*\{[\s\S]*?channel_id:\s*selfUid[\s\S]*?\}\s*,\s*\.\.\.\(this\.searchResult\.friends[\s\S]*?\]/
    );
    // channelType 用 ChannelTypePerson（=1），与后端 /search/global 联系人段一致。
    expect(vmSrc).toMatch(/channel_type:\s*ChannelTypePerson/);
  });

  it("§C: injection is gated on !loadMoreing && !this.channel && non-empty keyword", () => {
    // 3 层守卫都必须在：
    //   - !this.loadMoreing —— loadMore 不重复注入
    //   - !this.channel     —— 会话内搜索（onlyMessage）不激活联系人段
    //   - keyword 非空/非纯空白 —— 空 keyword 不注入
    const guard =
      /!this\.loadMoreing[\s\S]{0,200}?!this\.channel[\s\S]{0,200}?this\.keyword[\s\S]{0,200}?trim\(\)\.length\s*>\s*0/;
    expect(guard.test(vmSrc)).toBe(true);
  });

  it("§D: idempotent — skip inject when a self entry already exists in friends", () => {
    // 防未来后端某天真返回 self 导致重复插入；也守 loadMore 场景。
    expect(vmSrc).toMatch(
      /\!\(this\.searchResult\.friends[\s\S]{0,80}?\)\.some\(\s*\(f:\s*any\)\s*=>\s*f\.channel_id\s*===\s*selfUid\s*\)/
    );
  });

  it("§E: <mark> highlight wraps escaped keyword, not raw", () => {
    // 拼接顺序：先 escapeHtml(kw)，再 selfName.split(escapedKw).join('<mark>escapedKw</mark>')。
    // 顺序反了（原始 kw 直接 <mark>{kw}</mark>）会让 kw 里的 HTML 逃逸 sanitize
    // 白名单，绕过 XSS 防御。
    expect(vmSrc).toMatch(/const\s+escapedKw\s*=\s*escapeHtml\(kw\)/);
    expect(vmSrc).toMatch(/const\s+escapedName\s*=\s*escapeHtml\(selfName\)/);
    // markedName = escapedName.split(escapedKw).join(`<mark>${escapedKw}</mark>`)
    expect(vmSrc).toMatch(
      /escapedName\.split\(escapedKw\)\.join\(\s*`<mark>\$\{escapedKw\}<\/mark>`\s*\)/
    );
  });
});
