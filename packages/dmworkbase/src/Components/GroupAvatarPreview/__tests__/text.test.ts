import { describe, it, expect } from "vitest"
import {
  visibleChars,
  visibleCount,
  cleanAvatarText,
  groupNameText,
  groupAvatarLines,
  colorIndexForName,
} from "../text"

/**
 * GroupAvatarPreview 文字规则测试。
 *
 * 背景：text.ts 复刻了服务端 pkg/avatarrender 的取字 / 宽字符 / 换行 / 截断规则，
 * 仅用于建群前的本地实时预览。一旦服务端规则漂移而此处无测试兜底，预览会与保存后
 * 渲染的真图悄悄不一致。这里用 table-driven 锁住每条规则的边界。
 */

describe("visibleChars / visibleCount — 不可见字符与按字符切分", () => {
  const cases: Array<[string, string[]]> = [
    ["abc", ["a", "b", "c"]],
    ["a b", ["a", "b"]], // 空格不可见
    ["a​b", ["a", "b"]], // 零宽空格
    ["a\nb", ["a", "b"]], // 控制字符
    ["﻿项", ["项"]], // BOM
    ["😀A", ["😀", "A"]], // 代理对按单个字符
    ["", []],
  ]
  it.each(cases)("visibleChars(%j) → %j", (input, expected) => {
    expect(visibleChars(input)).toEqual(expected)
  })

  it("visibleCount 等于可见字符数（供 ≤4 校验）", () => {
    expect(visibleCount("a b c")).toBe(3)
    expect(visibleCount("项目工作组")).toBe(5)
    expect(visibleCount("​﻿")).toBe(0)
  })
})

describe("cleanAvatarText — 可见字符前 4 截断", () => {
  const cases: Array<[string, string]> = [
    ["abcdef", "abcd"], // 超 4 截断
    ["abc", "abc"], // 未超
    ["项目工作组", "项目工作"], // 中文 5 → 4
    ["a b c d e", "abcd"], // 去空格后截断
    ["a​b​c", "abc"], // 去零宽
    ["", ""],
  ]
  it.each(cases)("cleanAvatarText(%j) → %j", (input, expected) => {
    expect(cleanAvatarText(input)).toBe(expected)
  })
})

describe("groupNameText — 命名群按群名取字（script 感知）", () => {
  const cases: Array<[string, string]> = [
    ["张三丰", "张三"], // 含宽字符 → 宽字符前 2
    ["项目群", "项目"],
    ["中A文B", "中文"], // 只取宽字符（忽略拉丁）
    ["123456", "12"], // 纯数字 → 前 2
    ["hello world", "HW"], // 拉丁 → 首字母缩写大写 ≤2
    ["alpha beta gamma", "AB"], // 缩写截到 2
    ["a1", "A"], // 仅一个字母词
    ["", ""], // 空
    ["😀🎉", ""], // 既非宽字符/数字/字母 → 空
  ]
  it.each(cases)("groupNameText(%j) → %j", (input, expected) => {
    expect(groupNameText(input)).toBe(expected)
  })
})

describe("groupAvatarLines — 单行 / 双行拆分", () => {
  const cases: Array<[string, string[]]> = [
    ["AB", ["AB"]], // ≤2 字 → 单行
    ["ABCD", ["ABCD"]], // 无宽字符 → 单行（即便 >2）
    ["项目群", ["项", "目群"]], // ≥3 且含宽字符 → 两行（上少下多）
    ["工作", ["工作"]], // 2 个宽字符 → 单行
    ["ab项目", ["ab", "项目"]], // 4 字含宽 → 平分
    ["a项目", ["a", "项目"]], // 3 字含宽 → 上 1 下 2
  ]
  it.each(cases)("groupAvatarLines(%j) → %j", (input, expected) => {
    expect(groupAvatarLines(input)).toEqual(expected)
  })
})

describe("colorIndexForName — 按名稳定派生色板下标", () => {
  it("size<=0 返回 0", () => {
    expect(colorIndexForName("anything", 0)).toBe(0)
    expect(colorIndexForName("anything", -3)).toBe(0)
  })

  it("同名稳定、落在 [0,size)", () => {
    for (const name of ["项目群", "team", "", "😀"]) {
      const a = colorIndexForName(name, 10)
      const b = colorIndexForName(name, 10)
      expect(a).toBe(b)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(10)
    }
  })

  it("不同名通常落在不同下标（哈希分散）", () => {
    const idxs = new Set(
      ["a", "b", "c", "d", "e", "f"].map((n) => colorIndexForName(n, 10)),
    )
    expect(idxs.size).toBeGreaterThan(1)
  })
})
