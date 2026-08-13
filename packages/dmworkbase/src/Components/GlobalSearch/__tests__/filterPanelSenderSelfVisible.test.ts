import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// GlobalSearchFilterPanel — Sender vs Member filter self-visibility guard.
//
// 背景 (2026-08 Bug 2)：全局搜索 · 发送人过滤搜不到自己 —— 因为 Panel 在
// 冷启动初始 state（senderOptions useState 初值）和异步候选加载 useEffect
// 里都显式 `.filter((s) => s.uid !== dataSource.getSelfUid())`，把 dataSource
// seed 的 selfSender 剔掉了，用户搜自己名字命中不了。
//
// 产品语义澄清：
//   - 「发送人」过滤 = "谁发的这条消息"，搜自己发的消息完全合理 → 应含 self
//   - 「包含成员」过滤 = "这个会话得包含哪些人"，搜索者自己肯定在 → 应排除 self
//
// 修法只动 senderOptions 那两处；memberOptions 那两处保持排除 self。这份 suite
// 用源码断言锁住上述两分离，防未来 refactor 反悔或把 self 又 filter 回去。

const filterPanelPath = path.join(
  __dirname,
  "..",
  "GlobalSearchFilterPanel.tsx"
);
const filterPanelSrc = fs.readFileSync(filterPanelPath, "utf8");

// 按行拆，逐节做 slice 查找，避免大段 regex 跨行不稳。
const lines = filterPanelSrc.split("\n");

function sliceAround(kw: string, before = 0, after = 12): string {
  const idx = lines.findIndex((l) => l.includes(kw));
  if (idx < 0) return "";
  return lines.slice(Math.max(0, idx - before), idx + after + 1).join("\n");
}

describe("GlobalSearchFilterPanel sender/member self visibility (source guard)", () => {
  it("§A: senderOptions cold-state init keeps self (no selfUid filter)", () => {
    // Cold init：`useState<...>(() => dataSource.getSenders())`
    // 反面：`.filter((s) => s.uid !== dataSource.getSelfUid())` MUST NOT appear
    // 紧跟在 getSenders() 之后（即 senderOptions 的初始化闭包内）。
    const senderInitBlock = sliceAround(
      "const [senderOptions, setSenderOptions] = useState<ChannelSearchSender[]>",
      0,
      5
    );
    expect(senderInitBlock).toContain("dataSource.getSenders()");
    expect(senderInitBlock).not.toMatch(
      /dataSource\.getSenders\(\)[\s\S]*?\.filter\([\s\S]*?getSelfUid/
    );
  });

  it("§B: senderOptions async loader keeps self", () => {
    // 异步 loader 段：`setSenderOptions(list)` — 不再 `.filter(s => s.uid !== selfUid)`
    // 定位到 senderQuery 依赖的 useEffect body。
    const idx = filterPanelSrc.indexOf(
      "await dataSource.searchSenders?.(senderQuery)"
    );
    expect(idx).toBeGreaterThan(-1);
    // Take a 500-char window after the await call — captures setSenderOptions.
    const window = filterPanelSrc.slice(idx, idx + 500);
    expect(window).toMatch(/setSenderOptions\(list\)/);
    // 直接过滤 self 的形态不应出现在这个窗口内。
    expect(window).not.toMatch(/setSenderOptions\(list\.filter\([^)]*selfUid/);
  });

  it("§C: memberOptions async loader STILL filters self", () => {
    // memberOptions 语义是「会话得包含谁」，选自己无意义，必须保留 self filter。
    const idx = filterPanelSrc.indexOf(
      "await dataSource.searchSenders?.(memberQuery)"
    );
    expect(idx).toBeGreaterThan(-1);
    const window = filterPanelSrc.slice(idx, idx + 500);
    expect(window).toMatch(
      /setMemberOptions\(list\.filter\(\(s\)\s*=>\s*s\.uid\s*!==\s*selfUid\)\)/
    );
  });

  it("§D: toggleMember still short-circuits when uid === selfUid", () => {
    // 与 §C 同源约束：即使 self 意外出现在 memberOptions 里，也不能被勾选。
    expect(filterPanelSrc).toMatch(
      /const toggleMember\s*=\s*\(uid:\s*string\)\s*=>\s*\{[\s\S]{0,200}?if\s*\(uid\s*===\s*selfUid\)\s*return;/
    );
  });
});
