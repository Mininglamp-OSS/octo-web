import { describe, expect, it } from "vitest"
import { containsAllTaskIds } from "../heartbeatCoverage"

describe("containsAllTaskIds", () => {
    it("returns true when payload is a strict superset of my active ids", () => {
        expect(containsAllTaskIds([1, 2, 3, 4], [1, 2])).toBe(true)
    })

    it("returns true when payload equals my active ids", () => {
        expect(containsAllTaskIds([1, 2], [1, 2])).toBe(true)
    })

    it("returns false when payload covers only some of my active ids", () => {
        expect(containsAllTaskIds([1, 2], [1, 2, 3])).toBe(false)
    })

    it("returns false when payload is disjoint from my active ids", () => {
        expect(containsAllTaskIds([99, 100], [1, 2])).toBe(false)
    })

    it("returns true when I have no active ids (nothing to cover)", () => {
        expect(containsAllTaskIds([1, 2, 3], [])).toBe(true)
        expect(containsAllTaskIds([], [])).toBe(true)
        expect(containsAllTaskIds(undefined, [])).toBe(true)
    })

    it("returns false when I have active ids but payload is empty or undefined", () => {
        expect(containsAllTaskIds([], [1])).toBe(false)
        expect(containsAllTaskIds(undefined, [1])).toBe(false)
    })

    it("treats payload as a Set so lookup is O(1) even for large my-id arrays", () => {
        const big = Array.from({ length: 5000 }, (_, i) => i)
        const mine = Array.from({ length: 100 }, (_, i) => i * 47).filter(x => x < 5000)
        expect(containsAllTaskIds(big, mine)).toBe(true)
    })
})
