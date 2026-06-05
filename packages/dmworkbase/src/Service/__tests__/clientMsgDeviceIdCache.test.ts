import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadCachedNumericDeviceId,
  saveNumericDeviceId,
  clearCachedNumericDeviceId,
  STORAGE_KEY,
} from "../clientMsgDeviceIdCache"
import StorageService from "../StorageService"

describe("clientMsgDeviceIdCache", () => {
  beforeEach(() => {
    StorageService.shared.removeItem(STORAGE_KEY)
  })

  describe("loadCachedNumericDeviceId", () => {
    it("returns the numeric value when storage has a valid positive integer", () => {
      StorageService.shared.setItem(STORAGE_KEY, "42")
      expect(loadCachedNumericDeviceId()).toBe(42)
    })

    it("returns null when storage is empty", () => {
      expect(loadCachedNumericDeviceId()).toBeNull()
    })

    it("returns null when storage has a non-numeric string (NaN guard)", () => {
      StorageService.shared.setItem(STORAGE_KEY, "not-a-number")
      expect(loadCachedNumericDeviceId()).toBeNull()
    })

    it("returns null when storage has \"0\" (0 is the SDK default and indicates no real id)", () => {
      StorageService.shared.setItem(STORAGE_KEY, "0")
      expect(loadCachedNumericDeviceId()).toBeNull()
    })

    it("returns null when storage has a negative number", () => {
      StorageService.shared.setItem(STORAGE_KEY, "-5")
      expect(loadCachedNumericDeviceId()).toBeNull()
    })
  })

  describe("saveNumericDeviceId", () => {
    it("persists the numeric value as a string", () => {
      saveNumericDeviceId(123)
      expect(StorageService.shared.getItem(STORAGE_KEY)).toBe("123")
    })

    it("does not throw when StorageService.setItem throws (e.g., quota exceeded)", () => {
      const spy = vi.spyOn(StorageService.shared, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError")
      })
      expect(() => saveNumericDeviceId(99)).not.toThrow()
      spy.mockRestore()
    })

    it("does NOT persist a non-positive value (defensive; should never be called with 0)", () => {
      saveNumericDeviceId(0)
      expect(StorageService.shared.getItem(STORAGE_KEY)).toBeNull()
      saveNumericDeviceId(-1)
      expect(StorageService.shared.getItem(STORAGE_KEY)).toBeNull()
    })
  })

  describe("clearCachedNumericDeviceId", () => {
    it("removes the cached value", () => {
      StorageService.shared.setItem(STORAGE_KEY, "77")
      clearCachedNumericDeviceId()
      expect(StorageService.shared.getItem(STORAGE_KEY)).toBeNull()
    })

    it("is a no-op when no cached value present", () => {
      expect(() => clearCachedNumericDeviceId()).not.toThrow()
    })
  })

  describe("save → load round-trip", () => {
    it("round-trips a valid id", () => {
      saveNumericDeviceId(2024)
      expect(loadCachedNumericDeviceId()).toBe(2024)
    })
  })
})
